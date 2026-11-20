/**
 * PubChem lookups, straight from the browser.
 *
 * PUG REST sends `Access-Control-Allow-Origin: *`, so no proxy is needed and the
 * compound never touches a server of ours, the page talks to NCBI directly.
 */

const PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";

/** Properties requested in one call; the names are PubChem's, the mapping is ours. */
const PROPERTIES = [
  "Title",
  "IUPACName",
  "MolecularFormula",
  "MolecularWeight",
  "IsomericSMILES",
  "ConnectivitySMILES",
  "InChI",
  "InChIKey",
  "XLogP",
  "TPSA",
  "HBondDonorCount",
  "HBondAcceptorCount",
  "RotatableBondCount",
  "HeavyAtomCount",
  "Charge",
  "ExactMass",
  "MonoisotopicMass",
  "Complexity",
].join(",");

/** Mirrors `molplate_core::wikitext::Compound`; absent fields are simply not sent. */
export interface Compound {
  cid?: number;
  name?: string;
  iupac_name?: string;
  molecular_formula?: string;
  molecular_weight?: number;
  smiles?: string;
  inchi?: string;
  inchikey?: string;
  synonyms?: string[];
  cas_number?: string;
  xlogp?: number;
  exact_mass?: number;
  monoisotopic_mass?: number;
  tpsa?: number;
  complexity?: number;
  charge?: number;
  h_bond_donors?: number;
  h_bond_acceptors?: number;
  rotatable_bonds?: number;
  heavy_atoms?: number;
}

/** A `Compound` while it is being assembled: keys may be present but undefined. */
type CompoundFields = { [K in keyof Compound]?: Compound[K] | undefined };

export interface LoadResult {  compound: Compound;
  /** Structure to hand to the renderer, named for its format. */
  structure: { name: string; bytes: Uint8Array };
  /** Things the user should know about, e.g. a missing 3D record. */
  warnings: string[];
}

export class LookupError extends Error {}

/** Resolve a name, CID or SMILES and fetch everything the figure needs. */
export async function loadCompound(identifier: string): Promise<LoadResult> {
  const query = identifier.trim();
  if (!query) throw new LookupError("Enter a compound name, CID or SMILES.");

  const properties = await fetchProperties(query);
  const cid = properties.CID as number;
  const warnings: string[] = [];

  const [synonyms, structure] = await Promise.all([fetchSynonyms(cid), fetchStructure(cid, warnings)]);

  // Built without a `Compound` annotation on purpose: with
  // `exactOptionalPropertyTypes` the literal would be checked against it before
  // `compact` could drop the absent properties.
  const compound = compact({
    cid,
    name: asString(properties.Title) ?? query,
    iupac_name: asString(properties.IUPACName),
    molecular_formula: asString(properties.MolecularFormula),
    molecular_weight: asNumber(properties.MolecularWeight),
    smiles: asString(properties.SMILES) ?? asString(properties.ConnectivitySMILES),
    inchi: asString(properties.InChI),
    inchikey: asString(properties.InChIKey),
    synonyms,
    cas_number: synonyms.find(isCasNumber),
    xlogp: asNumber(properties.XLogP),
    exact_mass: asNumber(properties.ExactMass),
    monoisotopic_mass: asNumber(properties.MonoisotopicMass),
    tpsa: asNumber(properties.TPSA),
    complexity: asNumber(properties.Complexity),
    charge: asNumber(properties.Charge),
    h_bond_donors: asNumber(properties.HBondDonorCount),
    h_bond_acceptors: asNumber(properties.HBondAcceptorCount),
    rotatable_bonds: asNumber(properties.RotatableBondCount),
    heavy_atoms: asNumber(properties.HeavyAtomCount),
  });

  return { compound, structure, warnings };
}

/**
 * Drop keys whose value is `undefined`.
 *
 * PubChem omits properties for some compounds, and `exactOptionalPropertyTypes` forbids
 * assigning `undefined` to an optional field, so the object is written wide and narrowed
 * once. `JSON.stringify` would drop these keys anyway; doing it here keeps the type
 * honest as well.
 */
function compact(source: CompoundFields): Compound {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined),
  ) as Compound;
}

/**
 * Fetch properties for a name, CID or SMILES.
 *
 * PubChem resolves names itself, so the only ambiguity is SMILES: a string that is
 * neither a number nor a known name is tried as a structure first. The order matters
 * because a SMILES is also a valid "name" and would otherwise 404 slowly.
 */
async function fetchProperties(identifier: string): Promise<Record<string, unknown>> {
  if (/^\d+$/.test(identifier)) {
    return request(`${PUG}/compound/cid/${identifier}/property/${PROPERTIES}/JSON`);
  }

  const asSmiles = await tryCids(identifier);
  if (asSmiles !== null) {
    return request(`${PUG}/compound/cid/${asSmiles}/property/${PROPERTIES}/JSON`);
  }

  const byName = await requestOrNull(`${PUG}/compound/name/${encodeURIComponent(identifier)}/property/${PROPERTIES}/JSON`);
  if (byName !== null) {
    const row = propertiesRow(byName);
    if (row === null) throw new LookupError("PubChem returned an unexpected response.");
    return row;
  }

  throw new LookupError(`PubChem has no compound for “${identifier}”.`);
}

/** The single row inside PubChem's `PropertyTable` envelope. */
function propertiesRow(json: Record<string, unknown>): Record<string, unknown> | null {
  const table = json.PropertyTable as { Properties?: Record<string, unknown>[] } | undefined;
  return table?.Properties?.[0] ?? null;
}

/** Resolve a SMILES string to a CID, or `null` if PubChem does not know it. */
async function tryCids(smiles: string): Promise<string | null> {
  // A structure search is only worth trying for something that looks like a SMILES;
  // otherwise every misspelled name costs a slow round trip.
  if (!/[=#@()[\]]/.test(smiles) && !/^[A-Z][a-z]?\d*/.test(smiles)) return null;
  const json = await requestOrNull(`${PUG}/compound/smiles/${encodeURIComponent(smiles)}/cids/JSON`);
  const cids = (json?.IdentifierList as { CID?: number[] } | undefined)?.CID;
  return cids && cids.length > 0 ? String(cids[0]) : null;
}

async function fetchSynonyms(cid: number): Promise<string[]> {
  const json = await requestOrNull(`${PUG}/compound/cid/${cid}/synonyms/JSON`);
  const information = (json?.InformationList as { Information?: { Synonym?: string[] }[] } | undefined)
    ?.Information;
  const synonyms = information?.[0]?.Synonym ?? [];
  // Twelve is plenty: the infobox shows three, and the rest is for picking a file name.
  return synonyms.filter((entry) => entry.trim().length > 0).slice(0, 12);
}

/**
 * Fetch the 3D record, falling back to the 2D one.
 *
 * PubChem only has 3D coordinates for compounds somebody computed them for. A flat 2D
 * record still renders (it is honest: the molecule is planar in that file), but the
 * figure is not what the user asked for, so it is reported as a warning.
 */
async function fetchStructure(
  cid: number,
  warnings: string[],
): Promise<{ name: string; bytes: Uint8Array }> {
  const three = await requestBytes(`${PUG}/compound/cid/${cid}/record/SDF?record_type=3d`);
  if (three !== null) return { name: `${cid}.sdf`, bytes: three };

  const two = await requestBytes(`${PUG}/compound/cid/${cid}/record/SDF?record_type=2d`);
  if (two !== null) {
    warnings.push("PubChem has no 3D record for this compound; showing its 2D coordinates.");
    return { name: `${cid}.sdf`, bytes: two };
  }
  throw new LookupError("PubChem returned no structure record for this compound.");
}

async function request(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(path);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new LookupError(`PubChem request failed (${response.status}). ${firstLine(detail)}`);
  }
  const json = (await response.json()) as Record<string, unknown>;
  const properties = propertiesRow(json);
  if (properties === null) throw new LookupError("PubChem returned an unexpected response.");
  return properties;
}

async function requestOrNull(path: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(path);
  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}

async function requestBytes(path: string): Promise<Uint8Array | null> {
  const response = await fetch(path);
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** CAS registry numbers look like `50-78-2`; PubChem only exposes them via synonyms. */
function isCasNumber(value: string): boolean {
  return /^\d{2,7}-\d{2}-\d$/.test(value.trim());
}

function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
}

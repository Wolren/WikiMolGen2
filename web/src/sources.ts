/**
 * Metadata beside PubChem: Wikidata, the Wikipedia infobox and a drug label.
 *
 * All three answer with CORS headers except the DailyMed service. The browser cannot read
 * DailyMed, so openFDA serves the same SPL label data and allows the fetch. The source
 * list tells the user which one answered.
 */

import { requestJson } from "./net.js";
import type { Compound } from "./pubchem.js";

export interface SourceStatus {
  name: string;
  status: "ok" | "miss" | "blocked";
  detail: string;
}

export interface MetadataResult {
  /** Fields the other sources know. PubChem values win when both are present. */
  fields: Partial<Compound>;
  sources: SourceStatus[];
  notes: string[];
}

/** Query Wikidata by the English Wikipedia title and read the drug identifiers. */
export async function fetchMetadata(name: string): Promise<MetadataResult> {
  const sources: SourceStatus[] = [];
  const notes: string[] = [];
  const fields: Partial<Compound> = {};

  const [wikidata, wikipedia, label] = await Promise.all([
    fetchWikidata(name).catch(() => null),
    fetchWikipedia(name).catch(() => null),
    fetchLabel(name).catch(() => null),
  ]);

  if (wikidata !== null) {
    Object.assign(fields, wikidata.fields);
    sources.push(wikidata.status);
    if (wikidata.status.status === "ok") {
      notes.push("Identifiers from Wikidata.");
    }
  } else {
    sources.push({ name: "Wikidata", status: "miss", detail: "no answer" });
  }

  if (wikipedia !== null) {
    Object.assign(fields, wikipedia.fields);
    sources.push(wikipedia.status);
    if (wikipedia.status.status === "ok") {
      notes.push("Clinical fields from the Wikipedia infobox.");
    }
  } else {
    sources.push({ name: "Wikipedia", status: "miss", detail: "no answer" });
  }

  if (label !== null) {
    Object.assign(fields, label.fields);
    sources.push(label.status);
    if (label.status.status === "ok") {
      notes.push("Drug label data from openFDA.");
    }
  } else {
    sources.push({ name: "DailyMed", status: "miss", detail: "no answer" });
  }

  return { fields, sources, notes };
}

interface PartialSource {
  fields: Partial<Compound>;
  status: SourceStatus;
}

async function fetchWikidata(name: string): Promise<PartialSource | null> {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.search = new URLSearchParams({
    action: "wbgetentities",
    sites: "enwiki",
    titles: name,
    props: "claims|labels",
    languages: "en",
    format: "json",
    origin: "*",
  }).toString();

  const json = await requestJson<WikidataResponse>(url.toString(), {
    timeoutMs: 3500,
    retries: 0,
    cacheMs: 120_000,
  });
  const entities = json.entities ?? {};
  const entity = Object.entries(entities).find(([id]) => id !== "-1")?.[1];
  if (entity === undefined || entity.missing !== undefined) {
    return { fields: {}, status: { name: "Wikidata", status: "miss", detail: "no item" } };
  }

  const qid = Object.entries(entities).find(([id]) => id !== "-1")?.[0];
  const atc = claimStrings(entity, "P267");
  const firstAtc = atc[0];
  const fields: Partial<Compound> = {};
  if (qid !== undefined) fields.wikidata_qid = qid;
  const cas = claimString(entity, "P231");
  if (cas !== undefined) fields.cas_number = cas;
  const drugbank = claimString(entity, "P715");
  if (drugbank !== undefined) fields.drugbank_id = drugbank;
  const chembl = claimString(entity, "P592");
  if (chembl !== undefined) fields.chembl_id = chembl;
  if (firstAtc !== undefined && firstAtc.length === 7) {
    fields.atc_prefix = firstAtc.slice(0, 3);
    fields.atc_suffix = firstAtc.slice(3);
  }
  return {
    fields,
    status: {
      name: "Wikidata",
      status: "ok",
      detail: `${qid ?? "item"}${atc.length === 0 ? "" : `, ${atc.length} ATC code${atc.length === 1 ? "" : "s"}`}`,
    },
  };
}

interface WikidataResponse {
  entities?: Record<
    string,
    {
      missing?: unknown;
      claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]>;
    }
  >;
}

function claimString(entity: NonNullable<WikidataResponse["entities"]>[string], property: string): string | undefined {
  const value = entity.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function claimStrings(entity: NonNullable<WikidataResponse["entities"]>[string], property: string): string[] {
  const claims = entity.claims?.[property] ?? [];
  return claims
    .map((claim) => claim.mainsnak?.datavalue?.value)
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map((value) => value.trim());
}

/** Read the lead infobox. Wiki markup is stripped down to plain text. */
async function fetchWikipedia(name: string): Promise<PartialSource | null> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "parse",
    page: name,
    prop: "wikitext",
    section: "0",
    redirects: "1",
    format: "json",
    origin: "*",
  }).toString();

  const json = await requestJson<WikipediaResponse>(url.toString(), {
    timeoutMs: 4000,
    retries: 0,
    cacheMs: 120_000,
  });
  const text = json.parse?.wikitext?.["*"];
  if (typeof text !== "string" || text.length === 0) {
    return { fields: {}, status: { name: "Wikipedia", status: "miss", detail: "no page" } };
  }

  const fields = infoboxFields(text);
  const wanted: [string, keyof Compound][] = [
    ["routes_of_administration", "routes_of_administration"],
    ["legal_status", "legal_status"],
    ["atc_prefix", "atc_prefix"],
    ["atc_suffix", "atc_suffix"],
    ["pregnancy_category", "pregnancy_category"],
    ["bioavailability", "bioavailability"],
    ["protein_bound", "protein_bound"],
    ["metabolism", "metabolism"],
    ["elimination_half_life", "elimination_half_life"],
    ["excretion", "excretion"],
    ["class", "drug_class"],
  ];
  const out: Partial<Compound> = {};
  // The keys share one string value type; a typed setter keeps that fact in one place.
  const set = (key: keyof Compound, value: string | undefined): void => {
    if (value !== undefined && value !== "") (out as Record<string, string>)[key] = value;
  };
  for (const [field, target] of wanted) {
    set(target, fields.get(field));
  }
  return {
    fields: out,
    status: {
      name: "Wikipedia",
      status: "ok",
      detail: `${Object.keys(out).length} clinical field${Object.keys(out).length === 1 ? "" : "s"}`,
    },
  };
}

interface WikipediaResponse {
  parse?: { wikitext?: { "*"?: string } };
}

function infoboxFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = /^\s*\|\s*([a-z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (match === null) continue;
    const key = match[1]?.toLowerCase();
    const value = cleanWiki(match[2] ?? "");
    if (key !== undefined && value !== "" && !fields.has(key)) fields.set(key, value);
  }
  return fields;
}

/** Remove references, templates and links, leaving the text a template can hold. */
export function cleanWiki(value: string): string {
  return value
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

/**
 * Read a drug label. DailyMed has no CORS header, so the browser cannot read it; openFDA
 * serves the same SPL label data and allows the fetch.
 */
async function fetchLabel(name: string): Promise<PartialSource | null> {
  return tryOpenFda(name);
}

interface OpenFdaResponse {
  results?: {
    set_id?: string;
    effective_time?: string;
    openfda?: { manufacturer_name?: string[] };
  }[];
}

async function tryOpenFda(name: string): Promise<PartialSource | null> {
  const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(`openfda.generic_name:"${name}"`)}&limit=1`;
  try {
    const json = await requestJson<OpenFdaResponse>(url, {
      timeoutMs: 4000,
      retries: 0,
      cacheMs: 120_000,
    });
    const label = json.results?.[0];
    if (label === undefined) {
      return {
        fields: {},
        status: { name: "DailyMed", status: "miss", detail: "no openFDA label" },
      };
    }
    const manufacturer = label.openfda?.manufacturer_name?.[0];
    return {
      fields: {
        ...(label.set_id === undefined ? {} : { dailymed_setid: label.set_id }),
        ...(manufacturer === undefined ? {} : { dailymed_labeler: manufacturer }),
        ...(label.effective_time === undefined ? {} : { dailymed_effective: label.effective_time }),
      },
      status: {
        name: "DailyMed",
        status: "blocked",
        detail: "DailyMed has no CORS header; openFDA label used",
      },
    };
  } catch {
    return null;
  }
}

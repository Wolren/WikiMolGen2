/**
 * Protein records from RCSB PDB.
 *
 * `files.rcsb.org` answers with `Access-Control-Allow-Origin: *`, so the browser fetches a
 * PDB entry directly, the same way it talks to PubChem. Nothing is proxied.
 */

const RCSB = "https://files.rcsb.org/download";

export class ProteinError extends Error {}

export interface ProteinRecord {
  /** Four-character PDB identifier, upper case. */
  id: string;
  /** File name passed to the renderer, so its parser picks the PDB reader. */
  name: string;
  bytes: Uint8Array;
}

/**
 * Recognise a PDB identifier.
 *
 * PDB identifiers start with a digit and contain letters (`1CRN`). A pure number is a
 * PubChem CID, and `pdb:` forces the protein path for any input.
 */
export function pdbIdOf(identifier: string): string | null {
  const trimmed = identifier.trim();
  const explicit = /^pdb:\s*([0-9][a-z0-9]{3})$/i.exec(trimmed);
  if (explicit?.[1] !== undefined) return explicit[1].toUpperCase();
  if (/^\d+$/.test(trimmed)) return null;
  if (/^[0-9][a-z0-9]{3}$/i.test(trimmed)) return trimmed.toUpperCase();
  return null;
}

/** Fetch one PDB entry. The acceptance target, 1CRN, is about 25 KB. */
export async function loadProtein(id: string): Promise<ProteinRecord> {
  const response = await fetch(`${RCSB}/${id}.pdb`);
  if (!response.ok) {
    throw new ProteinError(`RCSB PDB has no entry ${id} (HTTP ${response.status}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // A missing entry can return an HTML page with status 200 from a mirror; a real record
  // starts with a HEADER or an ATOM line.
  const head = new TextDecoder().decode(bytes.subarray(0, 256));
  if (!/^(HEADER|ATOM|TITLE|REMARK|CRYST1)/m.test(head)) {
    throw new ProteinError(`RCSB PDB returned no PDB record for ${id}.`);
  }
  return { id, name: `${id}.pdb`, bytes };
}

/**
 * Protein records from RCSB PDB.
 *
 * `files.rcsb.org` answers with `Access-Control-Allow-Origin: *`, so the browser fetches a
 * PDB entry directly, the same way it talks to PubChem. Nothing is proxied.
 */

import { HttpError, NetworkError, requestBytes } from "./net.js";

const RCSB = "https://files.rcsb.org/download";

/** One PDB file is a few hundred kilobytes at most; a stalled fetch is not a slow record. */
const REQUEST_TIMEOUT_MS = 15_000;
const RECORD_CACHE_MS = 300_000;

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
  let bytes: Uint8Array;
  try {
    bytes = await requestBytes(`${RCSB}/${id}.pdb`, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      retries: 1,
      cacheMs: RECORD_CACHE_MS,
    });
  } catch (error) {
    if (error instanceof NetworkError) {
      throw new ProteinError(
        error.timeout
          ? `RCSB PDB did not answer within ${REQUEST_TIMEOUT_MS / 1000} s. Check the connection and try again.`
          : `Could not reach RCSB PDB (${error.message}).`,
      );
    }
    if (error instanceof HttpError) {
      throw new ProteinError(
        error.status === 404
          ? `RCSB PDB has no entry ${id} (HTTP 404).`
          : `RCSB PDB request failed (HTTP ${error.status}).`,
      );
    }
    throw error;
  }
  // A missing entry can return an HTML page with status 200 from a mirror; a real record
  // starts with a HEADER or an ATOM line.
  const head = new TextDecoder().decode(bytes.subarray(0, 256));
  if (!/^(HEADER|ATOM|TITLE|REMARK|CRYST1)/m.test(head)) {
    throw new ProteinError(`RCSB PDB returned no PDB record for ${id}.`);
  }
  return { id, name: `${id}.pdb`, bytes };
}

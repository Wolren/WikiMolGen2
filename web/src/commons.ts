/**
 * Commons upload details: the author line the description carries.
 *
 * The details survive a reload, so an uploader types a username once. Rust owns the block
 * text; this module only remembers what to put in the author parameter.
 */

/** The author a new visitor gets, matching the tool's own credit line. */
export const DEFAULT_AUTHOR = "WikiMolGen 2";

const STORAGE_KEY = "wikimolgen2.commons";

/** The parameters the Commons block takes from the page. */
export interface CommonsDetails {
  author: string;
}

/** Read the stored details, with a fallback for a blocked or corrupt store. */
export function loadCommonsDetails(): CommonsDetails {
  try {
    return parseCommonsDetails(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { author: DEFAULT_AUTHOR };
  }
}

/** Store the details. A blocked store only means the next load starts from the default. */
export function saveCommonsDetails(details: CommonsDetails): void {
  try {
    localStorage.setItem(STORAGE_KEY, serialiseCommonsDetails(details));
  } catch {
    // Private mode and a full quota both end here; the session keeps working.
  }
}

/** `null` and malformed payloads fall back to the default author. */
export function parseCommonsDetails(raw: string | null): CommonsDetails {
  if (raw === null) return { author: DEFAULT_AUTHOR };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { author: DEFAULT_AUTHOR };
  }
  if (typeof parsed !== "object" || parsed === null) return { author: DEFAULT_AUTHOR };
  const author = (parsed as { author?: unknown }).author;
  return { author: typeof author === "string" ? author.trim() : DEFAULT_AUTHOR };
}

export function serialiseCommonsDetails(details: CommonsDetails): string {
  return JSON.stringify({ author: details.author.trim() });
}

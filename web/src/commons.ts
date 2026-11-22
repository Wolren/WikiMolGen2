/**
 * Commons upload details: the author and the licence the description carries.
 *
 * The details survive a reload, so an uploader types a username once. Rust owns the block
 * text and the licence templates; this module only remembers the choices.
 */

/** The author a new visitor gets, matching the tool's own credit line. */
export const DEFAULT_AUTHOR = "WikiMolGen 2";

/** The licence choice that follows the structure kind. */
export const AUTO_LICENSE = "auto";

const STORAGE_KEY = "wikimolgen2.commons";

/** The parameters the Commons block takes from the page. */
export interface CommonsDetails {
  author: string;
  /** `auto`, a licence id from the wasm options, or `custom`. */
  license: string;
  /** The template body used when `license` is `custom`. */
  custom: string;
}

/** Read the stored details, with a fallback for a blocked or corrupt store. */
export function loadCommonsDetails(): CommonsDetails {
  try {
    return parseCommonsDetails(localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultDetails();
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

/** `null` and malformed payloads fall back to the defaults. */
export function parseCommonsDetails(raw: string | null): CommonsDetails {
  if (raw === null) return defaultDetails();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultDetails();
  }
  if (typeof parsed !== "object" || parsed === null) return defaultDetails();
  const record = parsed as { author?: unknown; license?: unknown; custom?: unknown };
  return {
    author: typeof record.author === "string" ? record.author.trim() : DEFAULT_AUTHOR,
    license: typeof record.license === "string" ? record.license : AUTO_LICENSE,
    custom: typeof record.custom === "string" ? record.custom : "",
  };
}

export function serialiseCommonsDetails(details: CommonsDetails): string {
  return JSON.stringify({
    author: details.author.trim(),
    license: details.license,
    custom: details.custom,
  });
}

function defaultDetails(): CommonsDetails {
  return { author: DEFAULT_AUTHOR, license: AUTO_LICENSE, custom: "" };
}

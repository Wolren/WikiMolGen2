/**
 * Foldable control sections, remembered across visits.
 *
 * The controls column is longer than a laptop viewport. The default figure is the common
 * case, so the finish and export knobs start folded; a click opens one and the choice is
 * stored the same way the theme is.
 */

const STORAGE_KEY = "molplate.sections";

type OpenState = Record<string, boolean>;

function readState(): OpenState {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    return typeof stored === "object" && stored !== null ? (stored as OpenState) : {};
  } catch {
    // A blocked store or bad JSON only means the section starts folded.
    return {};
  }
}

function writeState(state: OpenState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The choice then lasts for this visit.
  }
}

/** Apply the stored state and keep it up to date as sections open and close. */
export function bindSections(): void {
  const sections = Array.from(
    document.querySelectorAll<HTMLDetailsElement>("details.section"),
  );
  const state = readState();
  for (const section of sections) {
    if (typeof state[section.id] === "boolean") section.open = state[section.id];
    // The toggle event fires for a programmatic `open` too, so the listener goes last.
    section.addEventListener("toggle", () => {
      state[section.id] = section.open;
      writeState(state);
    });
  }
}

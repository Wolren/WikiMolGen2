/**
 * Recent figures: the last few lookups, so a figure can be reopened in one click.
 *
 * The list is data, not a setting: a full reset keeps it, and it survives a reload.
 */

/** The most entries the strip holds. */
const LIMIT = 8;
const STORAGE_KEY = "wikimolgen2.recent";

export type RecentKind = "two_d" | "three_d" | "protein";

export interface RecentFigure {
  /** What goes back into the identifier field. */
  identifier: string;
  kind: RecentKind;
  /** The name the strip shows. */
  label: string;
}

/** Newest first, one entry per identifier and kind, capped at {@link LIMIT}. */
export function addRecent(entries: RecentFigure[], entry: RecentFigure): RecentFigure[] {
  const key = (item: RecentFigure): string => `${item.kind}:${item.identifier.toLowerCase()}`;
  return [entry, ...entries.filter((item) => key(item) !== key(entry))].slice(0, LIMIT);
}

export function loadRecent(): RecentFigure[] {
  try {
    return parseRecent(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveRecent(entries: RecentFigure[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // A blocked store only means the strip starts empty next visit.
  }
}

/** Read a stored list, keeping entries that still have the right shape. */
export function parseRecent(raw: string | null): RecentFigure[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: RecentFigure[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as { identifier?: unknown; kind?: unknown; label?: unknown };
    if (typeof record.identifier !== "string" || record.identifier.trim() === "") continue;
    if (record.kind !== "two_d" && record.kind !== "three_d" && record.kind !== "protein") {
      continue;
    }
    const label =
      typeof record.label === "string" && record.label.trim() !== ""
        ? record.label.trim().slice(0, 60)
        : record.identifier.trim();
    entries.push({ identifier: record.identifier.trim(), kind: record.kind, label });
    if (entries.length >= LIMIT) break;
  }
  return entries;
}

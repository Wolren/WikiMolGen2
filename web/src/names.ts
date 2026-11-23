/**
 * Preset names: one label per entry, with a numeric suffix when a name is taken.
 *
 * The picker shows the name alone, so two entries with the same label are ambiguous.
 */

const MAX_NAME = 40;

/** A unique id for a saved entry; two saves in the same millisecond still differ. */
let counter = 0;

export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

/** A name not in `taken`, with ` 2`, ` 3` and so on when it is already used. */
export function uniqueName(name: string, taken: readonly string[]): string {
  const base = name.trim().slice(0, MAX_NAME);
  if (base === "") return "";
  if (!taken.includes(base)) return base;
  for (let number = 2; number < 100; number += 1) {
    const suffix = ` ${number}`;
    const candidate = `${base.slice(0, MAX_NAME - suffix.length)}${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return base;
}

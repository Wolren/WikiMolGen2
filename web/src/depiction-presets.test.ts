import { describe, expect, it } from "vitest";
import { BUILTIN_DEPICTION_PRESETS, parseDepictionPresets } from "./depiction-presets.js";
import { DEFAULT_DEPICTION_SETTINGS } from "./depiction-settings.js";

describe("parseDepictionPresets", () => {
  it("round-trips a stored list and fills missing options", () => {
    const stored = JSON.stringify([
      { id: "saved-1", name: "  Mine  ", settings: { bondLength: 44, stereo: true } },
    ]);
    const presets = parseDepictionPresets(stored);
    expect(presets).toHaveLength(1);
    expect(presets[0]?.name).toBe("Mine");
    expect(presets[0]?.settings.bondLength).toBe(44);
    expect(presets[0]?.settings.stereo).toBe(true);
    expect(presets[0]?.settings.highlightColor).toBe(
      DEFAULT_DEPICTION_SETTINGS.highlightColor,
    );
  });

  it("drops entries without an id or a name", () => {
    const stored = JSON.stringify([
      { name: "No id", settings: {} },
      { id: "saved-2", name: "", settings: {} },
      { id: "saved-3", name: "Kept", settings: {} },
    ]);
    expect(parseDepictionPresets(stored).map((preset) => preset.name)).toEqual(["Kept"]);
  });

  it("refuses a payload that is not a list", () => {
    expect(parseDepictionPresets(null)).toEqual([]);
    expect(parseDepictionPresets("{oops")).toEqual([]);
    expect(parseDepictionPresets('{"presets":[]}')).toEqual([]);
  });

  it("ships the two built-in templates with distinct ids", () => {
    expect(BUILTIN_DEPICTION_PRESETS.map((preset) => preset.id)).toEqual([
      "wikipedia-2d",
      "compact-2d",
    ]);
    expect(BUILTIN_DEPICTION_PRESETS[0]?.settings.bondLength).toBeGreaterThan(0);
  });
});

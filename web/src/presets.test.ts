import { describe, expect, it } from "vitest";
import { parsePresetFile, presetFileText } from "./presets.js";
import type { SavedPreset } from "./presets.js";

function preset(name: string, stickRadius: number): SavedPreset {
  return {
    id: `saved-${name}`,
    name,
    label: name,
    description: "test",
    appearance: { stick_radius: stickRadius, ambient: 0.4 },
    quality: 3,
  };
}

describe("presetFileText", () => {
  it("writes a tagged file with the preset fields", () => {
    const file = JSON.parse(presetFileText([preset("Firm", 0.3)]));
    expect(file.kind).toBe("wikimolgen2-presets");
    expect(file.version).toBe(1);
    expect(file.presets).toEqual([
      { name: "Firm", appearance: { stick_radius: 0.3, ambient: 0.4 }, quality: 3 },
    ]);
  });
});

describe("parsePresetFile", () => {
  it("round-trips a written file", () => {
    const result = parsePresetFile(presetFileText([preset("Firm", 0.3)]));
    if ("error" in result) throw new Error(result.error);
    expect(result.presets).toEqual([
      { name: "Firm", appearance: { stick_radius: 0.3, ambient: 0.4 }, quality: 3 },
    ]);
  });

  it("refuses a file that is not a preset file", () => {
    expect(parsePresetFile("not json")).toHaveProperty("error");
    expect(parsePresetFile("[]")).toHaveProperty("error");
    expect(parsePresetFile('{"kind":"wikimolgen2-theme","version":1,"presets":[]}')).toHaveProperty(
      "error",
    );
    expect(parsePresetFile('{"kind":"wikimolgen2-presets","version":2,"presets":[]}')).toHaveProperty(
      "error",
    );
  });

  it("drops unnamed presets and fields the preset does not own", () => {
    const text = JSON.stringify({
      kind: "wikimolgen2-presets",
      version: 1,
      presets: [
        { name: "  ", appearance: {}, quality: 2 },
        {
          name: "Clean",
          appearance: { stick_radius: 0.25, scheme: "dark", background: "#000000" },
          quality: 2,
        },
      ],
    });
    const result = parsePresetFile(text);
    if ("error" in result) throw new Error(result.error);
    expect(result.presets).toHaveLength(1);
    expect(result.presets[0]?.appearance).toEqual({ stick_radius: 0.25 });
  });

  it("fails when no preset has a name", () => {
    const text = JSON.stringify({
      kind: "wikimolgen2-presets",
      version: 1,
      presets: [{ name: "", quality: 2 }],
    });
    expect(parsePresetFile(text)).toHaveProperty("error");
  });
});

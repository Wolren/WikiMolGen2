import { describe, expect, it } from "vitest";
import { colourFileText, parseColourFile } from "./colour-scheme.js";

const SCHEME = {
  scheme: "jmol",
  stickColor: "#808080",
  elementColors: [{ element: "C", color: "#232323" }],
};

describe("colourFileText", () => {
  it("writes a tagged file", () => {
    const file = JSON.parse(colourFileText(SCHEME));
    expect(file.kind).toBe("wikimolgen2-colours");
    expect(file.version).toBe(1);
    expect(file.scheme).toBe("jmol");
    expect(file.stick_color).toBe("#808080");
    expect(file.element_colors).toEqual([{ element: "C", color: "#232323" }]);
  });
});

describe("parseColourFile", () => {
  it("round-trips a written file", () => {
    const result = parseColourFile(colourFileText(SCHEME));
    if ("error" in result) throw new Error(result.error);
    expect(result.colours).toEqual(SCHEME);
  });

  it("refuses a file that is not a colour file", () => {
    expect(parseColourFile("nope")).toHaveProperty("error");
    expect(parseColourFile('{"kind":"wikimolgen2-presets","version":1}')).toHaveProperty("error");
    expect(parseColourFile('{"kind":"wikimolgen2-colours","version":9}')).toHaveProperty("error");
  });

  it("drops bad inks and keeps one entry per element", () => {
    const text = JSON.stringify({
      kind: "wikimolgen2-colours",
      version: 1,
      scheme: "cpk",
      stick_color: "gray50",
      element_colors: [
        { element: "C", color: "#111111" },
        { element: "C", color: "#222222" },
        { element: "O", color: "red" },
        { element: "", color: "#333333" },
        { element: "N", color: "#445566" },
      ],
    });
    const result = parseColourFile(text);
    if ("error" in result) throw new Error(result.error);
    expect(result.colours.elementColors).toEqual([
      { element: "C", color: "#222222" },
      { element: "N", color: "#445566" },
    ]);
    expect(result.colours.stickColor).toBeNull();
  });

  it("fails when nothing is a colour", () => {
    const text = JSON.stringify({ kind: "wikimolgen2-colours", version: 1 });
    expect(parseColourFile(text)).toHaveProperty("error");
  });
});

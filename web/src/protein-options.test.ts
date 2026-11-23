import { describe, expect, it } from "vitest";
import { DEFAULT_PROTEIN_OPTIONS, parseProteinOptions } from "./protein-options.js";

describe("parseProteinOptions", () => {
  it("falls back to the defaults for a missing or broken payload", () => {
    expect(parseProteinOptions(null)).toEqual(DEFAULT_PROTEIN_OPTIONS);
    expect(parseProteinOptions("{oops")).toEqual(DEFAULT_PROTEIN_OPTIONS);
    expect(parseProteinOptions("[]")).toEqual(DEFAULT_PROTEIN_OPTIONS);
  });

  it("keeps the switches that are booleans", () => {
    expect(
      parseProteinOptions(
        JSON.stringify({ ligand: true, water: true, residueLabels: true, fancyHelices: false }),
      ),
    ).toEqual({
      ligand: true,
      water: true,
      residueLabels: true,
      fancyHelices: false,
      flatSheets: DEFAULT_PROTEIN_OPTIONS.flatSheets,
    });
  });

  it("ignores values of the wrong type", () => {
    expect(parseProteinOptions(JSON.stringify({ ligand: "yes", flatSheets: 0 }))).toEqual(
      DEFAULT_PROTEIN_OPTIONS,
    );
  });
});

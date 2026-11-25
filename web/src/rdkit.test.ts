import { describe, expect, it } from "vitest";
import { acsDetails } from "./rdkit.js";

describe("acsDetails", () => {
  it("matches RDKit's SetACS1996Mode values", () => {
    expect(acsDetails(1)).toEqual({
      width: -1,
      height: -1,
      fixedBondLength: 14.4,
      fixedFontSize: 10,
      bondLineWidth: 0.6,
      multipleBondOffset: 0.18,
      additionalAtomLabelPadding: 0.066,
      padding: 0.05,
    });
  });

  it("scales the fixed bond length by the record's mean", () => {
    expect(acsDetails(1.5).fixedBondLength).toBeCloseTo(9.6);
    expect(acsDetails(0).fixedBondLength).toBe(14.4);
  });
});

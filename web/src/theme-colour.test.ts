import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  ensureContrast,
  mixHex,
  parseColour,
  readableInk,
  relativeLuminance,
  toHex,
  withAlpha,
} from "./theme-colour.js";

describe("parseColour", () => {
  it("reads short and long hex", () => {
    expect(parseColour("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColour("#0e6d68")).toEqual({ r: 14, g: 109, b: 104 });
  });

  it("reads CSS rgb values", () => {
    expect(parseColour("rgb(14 109 104 / 26%)")).toEqual({ r: 14, g: 109, b: 104 });
    expect(parseColour("rgba(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3 });
  });

  it("rejects text that is not a colour", () => {
    expect(parseColour("teal")).toBeNull();
    expect(parseColour("#12")).toBeNull();
  });
});

describe("toHex", () => {
  it("clamps and pads every channel", () => {
    expect(toHex({ r: 300, g: -4, b: 14 })).toBe("#ff000e");
    expect(toHex({ r: 14, g: 109, b: 104 })).toBe("#0e6d68");
  });
});

describe("mixHex", () => {
  it("keeps the endpoints", () => {
    expect(mixHex("#123456", "#abcdef", 0)).toBe("#123456");
    expect(mixHex("#123456", "#abcdef", 1)).toBe("#abcdef");
  });

  it("lands between black and white", () => {
    const middle = mixHex("#000000", "#ffffff", 0.5);
    const luminance = relativeLuminance(middle);
    expect(luminance).toBeGreaterThan(0.05);
    expect(luminance).toBeLessThan(0.5);
  });
});

describe("contrast", () => {
  it("scores black on white at 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("chooses a readable ink", () => {
    expect(readableInk("#000000")).toBe("#ffffff");
    expect(readableInk("#ffffff")).toBe("#0b0f14");
  });

  it("lifts a pale ink to the floor", () => {
    const lifted = ensureContrast("#eeeeee", "#ffffff", 4.5);
    expect(contrastRatio(lifted, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves a passing ink alone", () => {
    expect(ensureContrast("#000000", "#ffffff", 4.5)).toBe("#000000");
  });
});

describe("withAlpha", () => {
  it("writes the space syntax the stylesheets use", () => {
    expect(withAlpha("#0e6d68", 0.26)).toBe("rgb(14 109 104 / 26%)");
  });
});

import { describe, expect, it, vi } from "vitest";
import { contrastRatio } from "./theme-colour.js";

vi.stubGlobal("window", {
  matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
});

const { decodeSharedTheme, deriveTheme, encodeTheme, themeFileText, themeFromFile } = await import(
  "./theme.js"
);

const SEED = {
  mode: "light" as const,
  accent: "#b34700",
  page: "#f4efe6",
  panel: "#fffaf2",
  text: "#2a2119",
  stage: "#f8f3ea",
};

const DARK_SEED = {
  mode: "dark" as const,
  accent: "#ffb454",
  page: "#0b0908",
  panel: "#171310",
  text: "#f5e9da",
  stage: "#120f0c",
};

describe("theme links", () => {
  it("round-trips a UTF-8 name", () => {
    const token = encodeTheme({ name: "Café chaud", seed: SEED });
    const shared = decodeSharedTheme(token);
    expect(shared?.name).toBe("Café chaud");
    expect(shared?.seed.accent).toBe("#b34700");
    expect(shared?.seed.panel).toBe("#fffaf2");
  });

  it("rejects a token from another format", () => {
    expect(decodeSharedTheme("not-a-token")).toBeNull();
    expect(decodeSharedTheme("")).toBeNull();
  });
});

describe("theme files", () => {
  it("round-trips through JSON", () => {
    const text = themeFileText({ name: "Warm", seed: SEED });
    const shared = themeFromFile(text);
    expect(shared?.name).toBe("Warm");
    expect(shared?.seed.stage).toBe("#f8f3ea");
  });

  it("rejects a foreign JSON file", () => {
    expect(themeFromFile(JSON.stringify({ kind: "something-else", version: 1 }))).toBeNull();
    expect(themeFromFile("{")).toBeNull();
  });
});

describe("deriveTheme", () => {
  it("keeps the contrast floors in a light theme", () => {
    const tokens = deriveTheme(SEED);
    expect(tokens.mode).toBe("light");
    expect(tokens.surface).toBe("#fffaf2");
    expect(tokens.canvas).toBe("#f4efe6");
    expect(tokens.stageTint).toBe("#f8f3ea");
    expect(contrastRatio(tokens.muted, tokens.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.faint, tokens.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.accent, tokens.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("reads a dark panel as a dark theme", () => {
    const tokens = deriveTheme(DARK_SEED);
    expect(tokens.mode).toBe("dark");
    expect(tokens.surface).toBe("#171310");
    expect(contrastRatio(tokens.ink, tokens.surface)).toBeGreaterThan(4.5);
    expect(contrastRatio(tokens.accent, tokens.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("falls back on a malformed seed", () => {
    const tokens = deriveTheme({
      mode: "light",
      accent: "not a colour",
      page: "",
      panel: "nope",
      text: "",
      stage: "",
    });
    expect(tokens.mode).toBe("light");
    expect(tokens.surface).toBe("#ffffff");
    expect(tokens.accent).toMatch(/^#[0-9a-f]{6}$/);
  });
});

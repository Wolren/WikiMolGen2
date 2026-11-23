import { describe, expect, it } from "vitest";
import { newId, uniqueName } from "./names.js";

describe("uniqueName", () => {
  it("keeps a free name", () => {
    expect(uniqueName("  Firm  ", [])).toBe("Firm");
    expect(uniqueName("Firm", ["Soft"])).toBe("Firm");
  });

  it("suffixes a taken name", () => {
    expect(uniqueName("Firm", ["Firm"])).toBe("Firm 2");
    expect(uniqueName("Firm", ["Firm", "Firm 2"])).toBe("Firm 3");
  });

  it("keeps the result inside the name budget", () => {
    const long = "a".repeat(40);
    const result = uniqueName(long, [long]);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result.endsWith(" 2")).toBe(true);
  });

  it("returns an empty string for an empty name", () => {
    expect(uniqueName("   ", ["Firm"])).toBe("");
  });
});

describe("newId", () => {
  it("gives every saved entry its own id", () => {
    const first = newId("saved");
    const second = newId("saved");
    expect(first).not.toBe(second);
    expect(first.startsWith("saved-")).toBe(true);
  });
});

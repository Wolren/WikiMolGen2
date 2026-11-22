import { describe, expect, it } from "vitest";
import { DEFAULT_AUTHOR, parseCommonsDetails, serialiseCommonsDetails } from "./commons.js";

describe("parseCommonsDetails", () => {
  it("falls back to the default author for a missing or broken payload", () => {
    expect(parseCommonsDetails(null).author).toBe(DEFAULT_AUTHOR);
    expect(parseCommonsDetails("{oops").author).toBe(DEFAULT_AUTHOR);
    expect(parseCommonsDetails("[1,2]").author).toBe(DEFAULT_AUTHOR);
    expect(parseCommonsDetails('{"author":7}').author).toBe(DEFAULT_AUTHOR);
  });

  it("keeps a typed author and trims it", () => {
    expect(parseCommonsDetails('{"author":"  Example  "}').author).toBe("Example");
  });

  it("round-trips through the stored form", () => {
    const stored = serialiseCommonsDetails({ author: " Example " });
    expect(parseCommonsDetails(stored).author).toBe("Example");
  });
});

import { describe, expect, it } from "vitest";
import { addRecent, parseRecent } from "./recent.js";
import type { RecentFigure } from "./recent.js";

function figure(identifier: string, kind: RecentFigure["kind"] = "three_d"): RecentFigure {
  return { identifier, kind, label: identifier };
}

describe("addRecent", () => {
  it("puts the newest entry first", () => {
    const entries = addRecent([figure("Aspirin")], figure("Ibuprofen"));
    expect(entries.map((entry) => entry.identifier)).toEqual(["Ibuprofen", "Aspirin"]);
  });

  it("moves a repeated identifier to the front without duplicating it", () => {
    const entries = addRecent([figure("Aspirin"), figure("Ibuprofen")], figure("Aspirin"));
    expect(entries.map((entry) => entry.identifier)).toEqual(["Aspirin", "Ibuprofen"]);
  });

  it("keeps at most eight entries", () => {
    let entries: RecentFigure[] = [];
    for (let index = 0; index < 12; index += 1) {
      entries = addRecent(entries, figure(`C${index}`));
    }
    expect(entries).toHaveLength(8);
    expect(entries[0]?.identifier).toBe("C11");
  });
});

describe("parseRecent", () => {
  it("keeps valid entries and drops the rest", () => {
    const raw = JSON.stringify([
      { identifier: "Aspirin", kind: "three_d", label: "Aspirin" },
      { identifier: "", kind: "three_d", label: "Empty" },
      { identifier: "1CRN", kind: "cartoon", label: "1CRN" },
      { identifier: "1UBQ", kind: "protein" },
    ]);
    expect(parseRecent(raw)).toEqual([
      { identifier: "Aspirin", kind: "three_d", label: "Aspirin" },
      { identifier: "1UBQ", kind: "protein", label: "1UBQ" },
    ]);
  });

  it("refuses a broken payload", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("{oops")).toEqual([]);
    expect(parseRecent('{"entries":[]}')).toEqual([]);
  });
});

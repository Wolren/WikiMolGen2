import { describe, expect, it } from "vitest";
import {
  clampView,
  panView,
  wheelFactor,
  zoomView,
  type ViewBox,
} from "./depiction-zoom.js";

const base: ViewBox = { x: 0, y: 0, width: 100, height: 50 };

describe("zoomView", () => {
  it("keeps the point under the cursor fixed and the aspect ratio", () => {
    const view = zoomView(base, base, { x: 25, y: 12.5 }, 2);
    expect(view.width).toBeCloseTo(50);
    expect(view.height).toBeCloseTo(25);
    expect((25 - view.x) / view.width).toBeCloseTo(0.25);
    expect((12.5 - view.y) / view.height).toBeCloseTo(0.25);
  });

  it("clamps the zoom out to twice the drawing", () => {
    expect(zoomView(base, base, { x: 50, y: 25 }, 1 / 1000).width).toBe(200);
  });

  it("clamps the zoom in to one sixteenth", () => {
    expect(zoomView(base, base, { x: 50, y: 25 }, 1000).width).toBeCloseTo(6.25);
  });
});

describe("clampView", () => {
  it("keeps the centre inside the drawing", () => {
    expect(clampView({ x: -100, y: -100, width: 50, height: 25 }, base)).toMatchObject({
      x: -25,
      y: -12.5,
    });
    expect(clampView({ x: 1000, y: 1000, width: 50, height: 25 }, base)).toMatchObject({
      x: 75,
      y: 37.5,
    });
  });
});

describe("panView", () => {
  it("moves the view against the drag", () => {
    const view = panView(base, base, 10, 5);
    expect(view.x).toBe(-10);
    expect(view.y).toBe(-5);
  });
});

describe("wheelFactor", () => {
  it("doubles in one direction and halves in the other", () => {
    expect(wheelFactor(-277)).toBeCloseTo(2);
    expect(wheelFactor(277)).toBeCloseTo(0.5);
  });
});

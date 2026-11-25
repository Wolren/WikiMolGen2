/**
 * Wheel zoom and drag pan for the inline 2D drawing.
 *
 * The SVG viewBox is the zoom state, so the vector stays crisp at any scale. A new
 * drawing resets the view; showing the same SVG again keeps it.
 */

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The furthest out the view may go, as a multiple of the drawing width. */
const MAX_WIDTH_RATIO = 2;
/** The closest the view may go, as a fraction of the drawing width. */
const MIN_WIDTH_RATIO = 1 / 16;
/** Wheel travel in pixels that halves the scale. */
const WHEEL_PIXELS_PER_DOUBLING = 277;

/** Keep the view centre inside the drawing, so the molecule cannot be lost. */
export function clampView(view: ViewBox, base: ViewBox): ViewBox {
  const left = base.x - view.width / 2;
  const right = base.x + base.width - view.width / 2;
  const top = base.y - view.height / 2;
  const bottom = base.y + base.height - view.height / 2;
  return {
    ...view,
    x: Math.min(Math.max(view.x, left), right),
    y: Math.min(Math.max(view.y, top), bottom),
  };
}

/** Zoom by `factor` around a point in drawing coordinates. */
export function zoomView(
  view: ViewBox,
  base: ViewBox,
  point: { x: number; y: number },
  factor: number,
): ViewBox {
  if (view.width <= 0 || base.width <= 0 || factor <= 0) return view;
  const aspect = base.height / base.width;
  const minWidth = base.width * MIN_WIDTH_RATIO;
  const maxWidth = base.width * MAX_WIDTH_RATIO;
  const width = Math.min(Math.max(view.width / factor, minWidth), maxWidth);
  const height = width * aspect;
  const ratioX = (point.x - view.x) / view.width;
  const ratioY = (point.y - view.y) / view.height;
  return clampView(
    { x: point.x - ratioX * width, y: point.y - ratioY * height, width, height },
    base,
  );
}

/** Move the view by a drag in drawing coordinates. */
export function panView(view: ViewBox, base: ViewBox, dx: number, dy: number): ViewBox {
  return clampView({ ...view, x: view.x - dx, y: view.y - dy }, base);
}

/** Wheel travel to a scale factor; up zooms in. */
export function wheelFactor(deltaY: number): number {
  return Math.exp((-deltaY / WHEEL_PIXELS_PER_DOUBLING) * Math.LN2);
}

let host: HTMLElement | null = null;
let svg: SVGSVGElement | null = null;
let base: ViewBox | null = null;
let view: ViewBox | null = null;
let drag: {
  pointerId: number;
  startX: number;
  startY: number;
  startView: ViewBox;
  scaleX: number;
  scaleY: number;
} | null = null;

/** The SVG currently inside the host, if any. */
function currentSvg(): SVGSVGElement | null {
  if (svg !== null && svg.isConnected) return svg;
  if (host === null) return null;
  const found = host.querySelector("svg");
  if (!(found instanceof SVGSVGElement)) return null;
  svg = found;
  if (base === null) base = readViewBox(found);
  if (view === null && base !== null) view = { ...base };
  return found;
}

function readViewBox(target: SVGSVGElement): ViewBox | null {
  const box = target.viewBox.baseVal;
  if (box.width <= 0 || box.height <= 0) return null;
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function sameBox(left: ViewBox, right: ViewBox): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function apply(target: SVGSVGElement | null): void {
  if (target === null || view === null) return;
  const round = (value: number): string => String(Number(value.toFixed(3)));
  target.setAttribute(
    "viewBox",
    `${round(view.x)} ${round(view.y)} ${round(view.width)} ${round(view.height)}`,
  );
}

/** Point the controller at a host, once per page. */
export function bindDepictionZoom(element: HTMLElement): void {
  host = element;
  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerUp);
  element.addEventListener("dblclick", onDoubleClick);
}

/** Adopt the host's SVG; `reset` starts from the whole drawing. */
export function attachDepictionZoom(element: HTMLElement, reset: boolean): void {
  host = element;
  const next = element.querySelector("svg");
  if (!(next instanceof SVGSVGElement)) {
    svg = null;
    base = null;
    view = null;
    return;
  }
  const nextBase = readViewBox(next);
  const previous = base;
  svg = next;
  base = nextBase;
  if (reset || view === null || previous === null || nextBase === null || !sameBox(previous, nextBase)) {
    view = nextBase === null ? null : { ...nextBase };
  }
  apply(svg);
}

/** Forget the drawing, so the next one starts fresh. */
export function detachDepictionZoom(): void {
  svg = null;
  base = null;
  view = null;
}

function svgPoint(
  target: SVGSVGElement,
  event: { clientX: number; clientY: number },
): { x: number; y: number } | null {
  const matrix = target.getScreenCTM();
  if (matrix === null) return null;
  const point = target.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const local = point.matrixTransform(matrix.inverse());
  return { x: local.x, y: local.y };
}

function onWheel(event: WheelEvent): void {
  const target = currentSvg();
  if (target === null || base === null || view === null) return;
  event.preventDefault();
  const point = svgPoint(target, event);
  if (point === null) return;
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
  view = zoomView(view, base, point, wheelFactor(delta));
  apply(target);
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || host === null) return;
  const target = currentSvg();
  if (target === null || view === null) return;
  const matrix = target.getScreenCTM();
  if (matrix === null || matrix.a === 0 || matrix.d === 0) return;
  drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startView: { ...view },
    scaleX: matrix.a,
    scaleY: matrix.d,
  };
  host.setPointerCapture(event.pointerId);
  host.classList.add("is-panning");
  event.preventDefault();
}

function onPointerMove(event: PointerEvent): void {
  if (drag === null || event.pointerId !== drag.pointerId || base === null) return;
  const dx = (event.clientX - drag.startX) / drag.scaleX;
  const dy = (event.clientY - drag.startY) / drag.scaleY;
  view = panView(drag.startView, base, dx, dy);
  apply(currentSvg());
}

function onPointerUp(event: PointerEvent): void {
  if (drag === null || event.pointerId !== drag.pointerId) return;
  if (host !== null) {
    host.classList.remove("is-panning");
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
  }
  drag = null;
}

function onDoubleClick(): void {
  if (base === null) return;
  view = { ...base };
  apply(currentSvg());
}

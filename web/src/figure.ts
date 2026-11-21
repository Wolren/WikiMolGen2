/**
 * Export: a PNG composed at an exact width, or the inline 2D SVG.
 *
 * The heavy pixel work is in Rust (`composeFigure`). This module only collects the
 * settings, asks the renderer for the raw frame, and hands it to the composer.
 */

import { composeFigure } from "../pkg/wikimolgen2_wasm.js";
import {
  describe,
  dom,
  figureName,
  hexToBytes,
  setBusy,
  setStatus,
  state,
  structureKind,
} from "./context.js";
import { depictionBytes, downloadSvg } from "./depiction.js";
import type { Renderer } from "./renderer.js";

/** patinae's offscreen export tops out at 8192 per edge on this build. */
const MAX_RENDER_EDGE = 8192;
/** About 240 MB of RGBA, before the compose copies. */
const MAX_RENDER_PIXELS = 60_000_000;
/** The figure width range. The height follows the stage aspect and the content. */
const MIN_WIDTH = 400;
const MAX_WIDTH = 8192;

/** A figure spec, mirrored from `wikimolgen2_core::figure::FigureSpec`. */
interface FigureSpec {
  width: number;
  margin: number;
  background: [number, number, number, number];
  gradient: [[number, number, number], [number, number, number]] | null;
  scale_bar: { angstrom_per_pixel: number } | null;
}

/** The Export panel's settings, shared by a single download and a batch. */
export interface FigureSettings {
  /** Figure width in pixels, clamped to the supported range. */
  width: number;
  /** Margin as a fraction of the width. */
  margin: number;
  /** Requested supersample factor, lowered when the budget needs it. */
  quality: number;
  transparent: boolean;
  labels: boolean;
  scaleBar: boolean;
}

/** One composed figure, ready to download or pack into an archive. */
export interface RenderedFigure {
  name: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  factor: number;
  marginPercent: number;
}

/** Download what the stage shows: the vector drawing in 2D mode, a PNG in 3D mode. */
export async function exportFigure(): Promise<void> {
  if (state.mode === "2d") {
    exportSvg();
    return;
  }
  await exportPng();
}

/** Save the inline SVG. It is already the full document, so no work is needed here. */
function exportSvg(): void {
  if (state.depiction === null) {
    setStatus("Load a compound before downloading a 2D drawing.", true);
    return;
  }
  const name = figureName("two_d");
  downloadSvg(name, state.depiction.svg);
  dom.fileName.textContent = name;
  setStatus(`Saved ${name} (${depictionBytes(state.depiction.svg)} bytes).`);
}

/**
 * Render above the wanted width, then compose the figure at an exact width.
 *
 * The supersample factor comes from the quality select, but a large width lowers it so
 * the render edge stays inside the safe GPU limit. The compose step trims the viewport,
 * scales the molecule to the inner width and pads the margin in Rust, so the exported
 * width is the number the user chose.
 */
async function exportPng(): Promise<void> {
  const viewer = state.viewer;
  if (viewer === null) return;

  const settings = readFigureSettings();
  const name = state.compound === null ? "molecule-3D.png" : figureName(structureKind());

  setBusy(true, "Rendering…");
  dom.exportButton.disabled = true;

  try {
    const figure = await renderFigure(viewer, settings, name);
    download(figure.name, figure.bytes);
    dom.fileName.textContent = figure.name;
    setStatus(
      `Saved ${figure.name} at ${figure.width}x${figure.height} px, ${figure.marginPercent}% margin, ` +
        `${figure.factor}x supersample` +
        `${figure.factor < settings.quality ? " (capped)" : ""}` +
        `${settings.transparent ? ", transparent" : ""}${settings.scaleBar ? ", with a scale bar" : ""}.`,
    );
  } catch (error) {
    setStatus(`Export failed: ${describe(error)}`, true);
  } finally {
    dom.exportButton.disabled = false;
    setBusy(false);
  }
}

/** Read the Export panel into the values a render needs. */
export function readFigureSettings(): FigureSettings {
  const requested = Number(dom.exportWidth.value);
  const width = Number.isFinite(requested)
    ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(requested)))
    : 1600;
  if (dom.exportWidth.value !== String(width)) {
    dom.exportWidth.value = String(width);
  }
  return {
    width,
    margin: Number(dom.exportMargin.value) / 100,
    quality: Number(dom.exportQuality.value),
    transparent: dom.exportTransparent.checked,
    labels: dom.exportLabels.checked,
    scaleBar: dom.exportScaleBar.checked,
  };
}

/**
 * Render and compose one figure from the current scene.
 *
 * The caller loads the structure, applies the look and frames it first; this function
 * only measures, renders offscreen and hands the pixels to the Rust composer.
 */
export async function renderFigure(
  viewer: Renderer,
  settings: FigureSettings,
  name: string,
): Promise<RenderedFigure> {
  const targetWidth = settings.width;
  const rect = dom.viewerHost.getBoundingClientRect();
  const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;
  const targetHeight = Math.max(1, Math.round(targetWidth / aspect));
  if (targetWidth * targetHeight > MAX_RENDER_PIXELS) {
    throw new Error("This figure needs more pixels than the GPU budget allows. Lower the width.");
  }

  const maxEdge = Math.max(targetWidth, targetHeight);
  const factorByEdge = Math.floor(MAX_RENDER_EDGE / maxEdge);
  const factorByPixels = Math.floor(
    Math.sqrt(MAX_RENDER_PIXELS / (targetWidth * targetHeight)),
  );
  const factor = Math.max(1, Math.min(settings.quality, factorByEdge, factorByPixels));
  const renderWidth = targetWidth * factor;
  const renderHeight = targetHeight * factor;

  if (settings.labels) {
    await viewer.setLabels(true);
    // The label is measured in render pixels; the figure scales it down with the scene.
    await viewer.setLabelSize(Math.round(18 * (targetWidth / 1600) * factor));
  } else {
    await viewer.setLabels(false);
  }

  try {
    let scaleBar: { angstrom_per_pixel: number } | null = null;
    if (settings.scaleBar) {
      const camera = await viewer.cameraView();
      if (camera !== null) {
        scaleBar = { angstrom_per_pixel: camera.viewHeight / renderHeight };
      }
    }

    // A gradient cannot be keyed out of an opaque render: the content rectangle would
    // show its own flat background. Render with alpha and composite the gradient behind.
    const gradient: [[number, number, number], [number, number, number]] | null =
      settings.transparent || state.look === null || state.look.appearance.gradient === null
        ? null
        : [
            hexToBytes(state.look.appearance.gradient[0]),
            hexToBytes(state.look.appearance.gradient[1]),
          ];

    const background = state.look?.appearance.background ?? dom.background.value;
    const blob = await viewer.exportPng({
      width: renderWidth,
      height: renderHeight,
      transparent: settings.transparent || gradient !== null,
      background,
    });
    const rendered = new Uint8Array(await blob.arrayBuffer());
    const [red, green, blue] = hexToBytes(background);

    const spec: FigureSpec = {
      width: targetWidth,
      margin: settings.margin,
      background: settings.transparent ? [0, 0, 0, 0] : [red, green, blue, 255],
      gradient,
      scale_bar: scaleBar,
    };
    const framed = composeFigure(rendered, JSON.stringify(spec));
    const size = pngSize(framed);
    return {
      name,
      bytes: framed,
      width: size.width,
      height: size.height,
      factor,
      marginPercent: Math.round(settings.margin * 100),
    };
  } finally {
    if (settings.labels) await viewer.setLabelSize(14).catch(() => undefined);
  }
}

/** Width and height from a PNG header, without a decoder. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24) return { width: 0, height: 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function download(name: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Revoking immediately can race the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Wire the export controls once, after the document exists. */
export function bindExport(): void {
  dom.exportMargin.addEventListener("input", () => {
    dom.exportMarginValue.textContent = `${dom.exportMargin.value}%`;
  });

  dom.exportButton.addEventListener("click", () => {
    void exportFigure();
  });
}

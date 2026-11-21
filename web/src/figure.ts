/**
 * Export: a PNG composed at an exact width, or the inline 2D SVG.
 *
 * The heavy pixel work is in Rust (`composeFigure`). This module only collects the
 * settings, asks the renderer for the raw frame, and hands it to the composer.
 */

import { composeFigure } from "../pkg/molplate_wasm.js";
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

/** Render this many times wider than the figure and scale down in Rust. */
const SUPERSAMPLE = 2;

/** A figure spec, mirrored from `molplate_core::figure::FigureSpec`. */
interface FigureSpec {
  width: number;
  margin: number;
  background: [number, number, number, number];
  gradient: [[number, number, number], [number, number, number]] | null;
  scale_bar: { angstrom_per_pixel: number } | null;
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
 * Render at twice the wanted width, then compose the figure at an exact width.
 *
 * patinae renders offscreen at whatever size is asked for, so there is no canvas resize,
 * no device-pixel-ratio correction and no screenshot handshake to wait on. The compose
 * step trims the viewport, scales the molecule to the inner width and pads the margin in
 * Rust, so the exported width is the number the user chose.
 */
async function exportPng(): Promise<void> {
  const viewer = state.viewer;
  if (viewer === null) return;

  const targetWidth = Number(dom.exportWidth.value);
  const margin = Number(dom.exportMargin.value) / 100;
  const rect = dom.viewerHost.getBoundingClientRect();
  const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;
  const targetHeight = Math.max(1, Math.round(targetWidth / aspect));
  const renderWidth = targetWidth * SUPERSAMPLE;
  const renderHeight = targetHeight * SUPERSAMPLE;
  const transparent = dom.exportTransparent.checked;
  const labels = dom.exportLabels.checked;

  setBusy(true, "Rendering…");
  dom.exportButton.disabled = true;

  try {
    if (labels) {
      await viewer.setLabels(true);
      // The label is measured in render pixels; the figure scales it down with the scene.
      await viewer.setLabelSize(Math.round(18 * (targetWidth / 1600) * SUPERSAMPLE));
    } else {
      await viewer.setLabels(false);
    }

    let scaleBar: { angstrom_per_pixel: number } | null = null;
    if (dom.exportScaleBar.checked) {
      const camera = await viewer.cameraView();
      if (camera !== null) {
        scaleBar = { angstrom_per_pixel: camera.viewHeight / renderHeight };
      }
    }

    // A gradient cannot be keyed out of an opaque render: the content rectangle would
    // show its own flat background. Render with alpha and composite the gradient behind.
    const gradient: [[number, number, number], [number, number, number]] | null =
      transparent || state.look === null || state.look.appearance.gradient === null
        ? null
        : [
            hexToBytes(state.look.appearance.gradient[0]),
            hexToBytes(state.look.appearance.gradient[1]),
          ];

    const blob = await viewer.exportPng({
      width: renderWidth,
      height: renderHeight,
      transparent: transparent || gradient !== null,
    });
    const rendered = new Uint8Array(await blob.arrayBuffer());
    const [red, green, blue] = hexToBytes(state.look?.appearance.background ?? dom.background.value);

    const spec: FigureSpec = {
      width: targetWidth,
      margin,
      background: transparent ? [0, 0, 0, 0] : [red, green, blue, 255],
      gradient,
      scale_bar: scaleBar,
    };
    const framed = composeFigure(rendered, JSON.stringify(spec));
    const size = pngSize(framed);

    const name = state.compound === null ? "molecule-3D.png" : figureName(structureKind());
    download(name, framed);
    dom.fileName.textContent = name;
    setStatus(
      `Saved ${name} at ${size.width}x${size.height} px, ${dom.exportMargin.value}% margin` +
        `${transparent ? ", transparent" : ""}${scaleBar === null ? "" : ", with a scale bar"}.`,
    );
  } catch (error) {
    setStatus(`Export failed: ${describe(error)}`, true);
  } finally {
    if (labels) await viewer.setLabelSize(14).catch(() => undefined);
    dom.exportButton.disabled = false;
    setBusy(false);
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

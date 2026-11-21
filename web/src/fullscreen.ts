/**
 * Full screen for the figure.
 *
 * The stage is the element that goes full screen, so the toolbar stays on top of the
 * canvas and the download is still in reach. The button is hidden where the API is not
 * available, which is the case inside an iframe without `allowfullscreen`.
 */

import { dom } from "./context.js";

/** The box that goes full screen: the figure card, not the page. */
function stageElement(): HTMLElement | null {
  const stage = dom.viewerHost.closest(".stage");
  return stage instanceof HTMLElement ? stage : null;
}

function syncButton(): void {
  const active = document.fullscreenElement !== null;
  dom.fullscreen.textContent = active ? "Exit full screen" : "Full screen";
  dom.fullscreen.setAttribute("aria-pressed", String(active));
}

/** Wire the full-screen button once, after the document exists. */
export function bindFullscreen(): void {
  const stage = stageElement();
  if (stage === null) return;
  // A browser without the API, or an iframe without the permission, gets no button
  // rather than one that does nothing.
  if (!document.fullscreenEnabled) {
    dom.fullscreen.hidden = true;
    return;
  }

  dom.fullscreen.hidden = false;
  dom.fullscreen.addEventListener("click", () => {
    if (document.fullscreenElement === null) {
      void stage.requestFullscreen().catch(() => {
        // A refused request leaves the layout alone; the toolbar button stays as it is.
      });
    } else {
      void document.exitFullscreen().catch(() => undefined);
    }
  });
  document.addEventListener("fullscreenchange", syncButton);
  syncButton();
}

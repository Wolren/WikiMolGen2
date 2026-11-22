/**
 * Keyboard shortcuts.
 *
 * A single listener keeps the page usable without the mouse: load, switch view, export,
 * frame and zoom. Keys stay out of the way while the compound field has focus.
 */

import { dom, type ViewMode } from "./context.js";

export interface KeyboardActions {
  load: () => void;
  setMode: (mode: ViewMode) => void;
  exportFigure: () => void;
  frame: () => void;
  zoom: (notches: number) => void;
}

export function bindKeyboard(actions: KeyboardActions): void {
  window.addEventListener("keydown", (event) => {
    // A modal owns its keys: Ctrl+Enter must not load behind the batch dialog.
    if (document.querySelector("dialog[open]") !== null) return;

    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    const inputType = target instanceof HTMLInputElement ? target.type : "";
    const editing =
      target !== null &&
      ((tag === "INPUT" &&
        !["range", "checkbox", "radio", "color", "button", "submit", "reset"].includes(inputType)) ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable);

    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      actions.load();
      return;
    }

    if (event.key === "Escape") {
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }

    if (editing) return;

    if (event.key === "?") {
      event.preventDefault();
      dom.shortcuts.open = !dom.shortcuts.open;
      if (dom.shortcuts.open) dom.shortcuts.scrollIntoView({ block: "nearest" });
      return;
    }

    switch (event.key) {
      case "/":
        event.preventDefault();
        dom.identifier.focus();
        dom.identifier.select();
        break;
      case "2":
        event.preventDefault();
        actions.setMode("2d");
        break;
      case "3":
        event.preventDefault();
        actions.setMode("3d");
        break;
      case "e":
      case "E":
        event.preventDefault();
        actions.exportFigure();
        break;
      case "f":
      case "F":
        event.preventDefault();
        actions.frame();
        break;
      case "+":
      case "=":
        event.preventDefault();
        actions.zoom(1);
        break;
      case "-":
      case "_":
        event.preventDefault();
        actions.zoom(-1);
        break;
      default:
        break;
    }
  });
}

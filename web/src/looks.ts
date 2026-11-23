/**
 * The style list: one radio per look, and applying the chosen one.
 */

import { appliedLook, markSettingsCustom, syncAppearance } from "./appearance.js";
import { cloneLook, describe, dom, setStatus, state, type Look } from "./context.js";
import { applyOrientation } from "./orientation.js";

export function renderLooks(): void {
  dom.looks.replaceChildren(
    ...state.looks.map((look) => {
      const label = document.createElement("label");
      label.className = "look";
      label.setAttribute("role", "radio");
      const checked = state.look?.id === look.id;
      label.setAttribute("aria-checked", String(checked));

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "look";
      input.value = look.id;
      input.checked = checked;
      input.addEventListener("change", () => void chooseLook(look));

      const swatch = document.createElement("span");
      swatch.className = "look-swatch";
      swatch.dataset.style = look.style;
      swatch.setAttribute("aria-hidden", "true");

      const text = document.createElement("span");
      text.className = "look-label";
      text.textContent = look.label;

      label.append(input, swatch, text);
      return label;
    }),
  );
}

async function chooseLook(look: Look): Promise<void> {
  // A copy, so the panel's edits never write back into the preset list.
  state.look = cloneLook(look);
  renderLooks();
  syncAppearance();
  markSettingsCustom();
  // patinae treats a command against an empty scene as an error, not a no-op.
  if (state.viewer === null || state.compound === null) return;
  try {
    await state.viewer.applyLook(appliedLook() ?? look);
    await applyOrientation(state.viewer);
  } catch (error) {
    setStatus(`Could not apply “${look.label}”: ${describe(error)}`, true);
  }
}

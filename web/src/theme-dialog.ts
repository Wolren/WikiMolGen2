/**
 * The theme picker: a preview grid of the fixed palettes and the saved custom ones, plus
 * the editor that builds a custom theme from five colours.
 *
 * Every card paints a miniature of the page with the tokens of the theme it offers, so a
 * choice is visual before it is applied. Selecting a card applies it at once; editing
 * previews the result on the live page and saves only on demand.
 */

import { required } from "./context.js";
import {
  BUILTIN_THEMES,
  TOKEN_VARIABLES,
  applyChoice,
  currentChoice,
  customThemes,
  deleteCustomTheme,
  deriveTheme,
  isCustomTheme,
  newCustomId,
  normaliseSeed,
  previewSeed,
  saveCustomTheme,
  seedsFromApplied,
  seedsFromBuiltin,
  themeLabel,
  themeSeedWarnings,
  type ThemeSeed,
  type ThemeTokens,
  type TokenKey,
} from "./theme.js";

const dialog = required<HTMLDialogElement>("theme-dialog");
const openButton = required<HTMLButtonElement>("theme-open");
const dot = required<HTMLElement>("theme-dot");
const label = required<HTMLElement>("theme-name");
const grid = required<HTMLDivElement>("theme-grid");
const pickerView = required<HTMLElement>("theme-picker-view");
const editor = required<HTMLFormElement>("theme-editor");
const newButton = required<HTMLButtonElement>("theme-new");
const editButton = required<HTMLButtonElement>("theme-edit");
const deleteButton = required<HTMLButtonElement>("theme-delete");
const doneButton = required<HTMLButtonElement>("theme-done");
const closeButton = required<HTMLButtonElement>("theme-close");
const cancelButton = required<HTMLButtonElement>("theme-cancel");
const nameInput = required<HTMLInputElement>("theme-custom-name");
const baseSelect = required<HTMLSelectElement>("theme-base");
const accentInput = required<HTMLInputElement>("theme-accent");
const pageInput = required<HTMLInputElement>("theme-page");
const panelInput = required<HTMLInputElement>("theme-panel");
const textInput = required<HTMLInputElement>("theme-text");
const stageInput = required<HTMLInputElement>("theme-stage");
const warning = required<HTMLParagraphElement>("theme-warning");

interface Editing {
  id: string;
  seed: ThemeSeed;
}

let editing: Editing | null = null;
/** The choice to restore if the editor is closed without saving. */
let beforeEdit = "system";
/** The custom theme whose delete button waits for a second click. */
let deleteArmed: string | null = null;

function refreshButton(): void {
  const name = themeLabel();
  label.textContent = name;
  openButton.title = name;
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim();
  dot.style.background = accent === "" ? "currentColor" : accent;
}

function panelPart(): HTMLElement {
  const panel = document.createElement("span");
  panel.className = "theme-shot-panel";
  for (const name of ["theme-shot-bar", "theme-shot-row", "theme-shot-row theme-shot-row-short"]) {
    const line = document.createElement("span");
    line.className = name;
    panel.append(line);
  }
  return panel;
}

function stagePart(): HTMLElement {
  const stage = document.createElement("span");
  stage.className = "theme-shot-stage";
  const molecule = document.createElement("span");
  molecule.className = "theme-shot-molecule";
  stage.append(molecule);
  return stage;
}

function themedShot(options: { preview?: string; tokens?: ThemeTokens }): HTMLElement {
  const shot = document.createElement("span");
  shot.className = "theme-shot";
  if (options.preview !== undefined) shot.dataset.themePreview = options.preview;
  if (options.tokens !== undefined) {
    for (const [key, variable] of Object.entries(TOKEN_VARIABLES)) {
      shot.style.setProperty(variable, options.tokens[key as TokenKey]);
    }
    shot.style.setProperty("color-scheme", options.tokens.mode);
  }
  shot.append(panelPart(), stagePart());
  return shot;
}

/** System offers both outcomes side by side: it cannot name one palette. */
function systemShot(): HTMLElement {
  const shot = document.createElement("span");
  shot.className = "theme-shot theme-shot-split";
  for (const mode of ["light", "dark"] as const) {
    const half = document.createElement("span");
    half.className = "theme-shot-half";
    half.dataset.themePreview = mode;
    half.append(panelPart(), stagePart());
    shot.append(half);
  }
  return shot;
}

function themeCard(
  value: string,
  name: string,
  description: string,
  custom: boolean,
  shot: HTMLElement,
): HTMLElement {
  const card = document.createElement("label");
  card.className = "theme-card";
  card.title = description;

  const input = document.createElement("input");
  input.type = "radio";
  input.name = "theme-choice";
  input.value = value;
  input.checked = value === currentChoice();
  input.addEventListener("change", () => {
    if (input.checked) select(value);
  });

  const text = document.createElement("span");
  text.className = "theme-card-name";
  text.textContent = name;
  card.append(input, shot, text);

  if (custom) {
    const tag = document.createElement("span");
    tag.className = "theme-card-tag";
    tag.textContent = "Custom";
    card.append(tag);
  }
  return card;
}

function renderPicker(): void {
  const cards: HTMLElement[] = [];
  for (const theme of BUILTIN_THEMES) {
    const shot = theme.id === "system" ? systemShot() : themedShot({ preview: theme.id });
    cards.push(themeCard(theme.id, theme.label, theme.description, false, shot));
  }
  for (const theme of customThemes()) {
    cards.push(
      themeCard(theme.id, theme.name, theme.name, true, themedShot({ tokens: deriveTheme(theme.seed) })),
    );
  }
  grid.replaceChildren(...cards);
  updateActions();
}

function updateActions(): void {
  const custom = isCustomTheme(currentChoice());
  editButton.disabled = !custom;
  deleteButton.disabled = !custom;
  if (!custom) {
    deleteArmed = null;
    deleteButton.textContent = "Delete";
  }
}

function select(value: string): void {
  deleteArmed = null;
  deleteButton.textContent = "Delete";
  applyChoice(value);
  updateActions();
}

function readSeed(): ThemeSeed {
  return normaliseSeed({
    mode: "light",
    accent: accentInput.value,
    page: pageInput.value,
    panel: panelInput.value,
    text: textInput.value,
    stage: stageInput.value,
  });
}

function updateWarning(): void {
  const warnings = themeSeedWarnings(readSeed());
  warning.hidden = warnings.length === 0;
  warning.textContent = warnings.join(" ");
}

function updatePreview(): void {
  if (editing === null) return;
  editing.seed = readSeed();
  previewSeed(editing.seed);
  updateWarning();
}

function fillEditor(seed: ThemeSeed): void {
  accentInput.value = seed.accent;
  pageInput.value = seed.page;
  panelInput.value = seed.panel;
  textInput.value = seed.text;
  stageInput.value = seed.stage;
  baseSelect.value = "current";
  updateWarning();
}

function openEditor(mode: "new" | "edit"): void {
  if (mode === "new") {
    beforeEdit = currentChoice();
    editing = {
      id: newCustomId(),
      seed: seedsFromApplied(),
    };
    nameInput.value = `Custom ${customThemes().length + 1}`;
  } else {
    const theme = customThemes().find((entry) => entry.id === currentChoice());
    if (theme === undefined) return;
    beforeEdit = theme.id;
    editing = { id: theme.id, seed: theme.seed };
    nameInput.value = theme.name;
  }
  fillEditor(editing.seed);
  pickerView.hidden = true;
  editor.hidden = false;
  nameInput.focus();
  nameInput.select();
}

function closeEditor(): void {
  const restore = beforeEdit;
  editing = null;
  editor.hidden = true;
  pickerView.hidden = false;
  applyChoice(restore);
  renderPicker();
}

function saveEditor(event: SubmitEvent): void {
  event.preventDefault();
  if (editing === null) return;
  const name = nameInput.value.trim();
  if (name === "") {
    nameInput.focus();
    return;
  }
  const saved = saveCustomTheme({ id: editing.id, name, seed: readSeed() });
  editing = null;
  editor.hidden = true;
  pickerView.hidden = false;
  applyChoice(saved.id);
  renderPicker();
  grid.querySelector<HTMLInputElement>(`input[value="${saved.id}"]`)?.focus();
}

function removeSelected(): void {
  const selected = currentChoice();
  if (!isCustomTheme(selected)) return;
  if (deleteArmed !== selected) {
    deleteArmed = selected;
    deleteButton.textContent = "Confirm delete";
    return;
  }
  deleteCustomTheme(selected);
  deleteArmed = null;
  deleteButton.textContent = "Delete";
  renderPicker();
  refreshButton();
  grid.querySelector<HTMLInputElement>("input:checked")?.focus();
}

function openDialog(): void {
  editing = null;
  editor.hidden = true;
  pickerView.hidden = false;
  deleteArmed = null;
  deleteButton.textContent = "Delete";
  renderPicker();
  refreshButton();
  dialog.showModal();
  requestAnimationFrame(() => {
    grid.querySelector<HTMLInputElement>("input:checked")?.focus();
  });
}

function closeDialog(): void {
  if (editing !== null) {
    editing = null;
    applyChoice(beforeEdit);
  }
  dialog.close();
}

/** Wire the button, the dialog and the editor once, after the document exists. */
export function bindThemeDialog(): void {
  editor.hidden = true;
  pickerView.hidden = false;
  refreshButton();

  openButton.addEventListener("click", openDialog);
  closeButton.addEventListener("click", closeDialog);
  doneButton.addEventListener("click", closeDialog);
  newButton.addEventListener("click", () => openEditor("new"));
  editButton.addEventListener("click", () => openEditor("edit"));
  deleteButton.addEventListener("click", removeSelected);
  cancelButton.addEventListener("click", closeEditor);
  editor.addEventListener("submit", saveEditor);

  for (const input of [accentInput, pageInput, panelInput, textInput, stageInput]) {
    input.addEventListener("input", updatePreview);
  }

  baseSelect.addEventListener("change", () => {
    if (baseSelect.value === "current") return;
    fillEditor(seedsFromBuiltin(baseSelect.value));
    updatePreview();
    baseSelect.value = "current";
  });

  dialog.addEventListener("close", () => {
    if (editing !== null) {
      editing = null;
      applyChoice(beforeEdit);
    }
    editor.hidden = true;
    pickerView.hidden = false;
    deleteArmed = null;
    deleteButton.textContent = "Delete";
    renderPicker();
  });

  document.addEventListener("themechange", refreshButton);
}

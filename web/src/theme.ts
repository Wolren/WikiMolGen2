/**
 * Interface themes: the chosen theme, the saved custom ones and the tokens they set.
 *
 * A built-in theme is a block in styles.css keyed by `data-theme`, so it paints before
 * this module loads. A custom theme is data: five seed colours expand into the full
 * token set, written inline and stored so the head script paints it before the first
 * frame.
 */

import {
  contrastRatio,
  ensureContrast,
  mixHex,
  parseColour,
  readableInk,
  relativeLuminance,
  toHex,
  withAlpha,
} from "./theme-colour.js";

export type ThemeMode = "light" | "dark";

/** The five colours a custom theme starts from; every other token is derived. */
export interface ThemeSeed {
  mode: ThemeMode;
  accent: string;
  page: string;
  panel: string;
  text: string;
  stage: string;
}

export interface BuiltinTheme {
  id: string;
  label: string;
  description: string;
  mode: ThemeMode;
}

export interface CustomTheme {
  id: string;
  name: string;
  seed: ThemeSeed;
}

/** A theme carried in a link or a file: the name and the five seed colours. */
export interface SharedTheme {
  name: string;
  seed: ThemeSeed;
}

/** The CSS custom properties a theme sets, in the token order the panel shows. */
export const TOKEN_VARIABLES = {
  ink: "--ink",
  muted: "--muted",
  faint: "--faint",
  line: "--line",
  lineStrong: "--line-strong",
  surface: "--surface",
  surface2: "--surface-2",
  surface3: "--surface-3",
  stageTint: "--stage-tint",
  field: "--field",
  canvas: "--canvas",
  code: "--code",
  accent: "--accent",
  accentStrong: "--accent-strong",
  accentInk: "--accent-ink",
  accentSoft: "--accent-soft",
  accentRing: "--accent-ring",
  danger: "--danger",
  dangerSoft: "--danger-soft",
  shadow1: "--shadow-1",
  shadow2: "--shadow-2",
} as const;

export type TokenKey = keyof typeof TOKEN_VARIABLES;
export type ThemeTokens = Record<TokenKey, string> & { mode: ThemeMode };

/**
 * The six fixed palettes, in the order the picker shows them.
 *
 * System is the seventh choice and resolves to Light or Dark, so it needs no palette of
 * its own. The colours live in styles.css; this list carries the labels and modes.
 */
export const BUILTIN_THEMES: BuiltinTheme[] = [
  {
    id: "system",
    label: "System",
    description: "Follows the operating system, including the high-contrast choice.",
    mode: "light",
  },
  {
    id: "light",
    label: "Light",
    description: "Neutral white with a teal accent.",
    mode: "light",
  },
  {
    id: "paper",
    label: "Paper",
    description: "Warm and low contrast, for long reading.",
    mode: "light",
  },
  {
    id: "contrast",
    label: "Contrast",
    description: "Black on white, for the strongest separation.",
    mode: "light",
  },
  {
    id: "dark",
    label: "Dark",
    description: "Teal on near-black, for low light.",
    mode: "dark",
  },
  {
    id: "slate",
    label: "Slate",
    description: "Cool blue-grey, calm in low light.",
    mode: "dark",
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Deep indigo with a violet accent.",
    mode: "dark",
  },
];

const CHOICE_KEY = "wikimolgen2.theme";
const MODE_KEY = "wikimolgen2.theme-mode";
const CUSTOM_KEY = "wikimolgen2.custom-themes";
const VARS_KEY = "wikimolgen2.theme-vars";
const SHARED_PARAM = "theme";
const MAX_CUSTOM_THEMES = 40;

const DEFAULT_SEED: ThemeSeed = {
  mode: "light",
  accent: "#0e6d68",
  page: "#f1f4f8",
  panel: "#ffffff",
  text: "#15181d",
  stage: "#f5f7fa",
};

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const systemContrast = window.matchMedia("(prefers-contrast: more)");

let activeChoice = "system";
let customCache: CustomTheme[] | null = null;
let previewing = false;
let storageTimer = 0;

/** Stop a cross-tab update from replacing an unsaved editor preview. */
export function setThemePreviewing(value: boolean): void {
  previewing = value;
}

function colour(value: string, fallback: string): string {
  const parsed = parseColour(value);
  return parsed === null ? fallback : toHex(parsed);
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // A blocked store only means the choice lasts for this visit.
    return null;
  }
}

function store(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // A full or blocked store still leaves the live page themed.
  }
}

/** Clamp the five seeds to valid hex, and let the panel decide light or dark. */
export function normaliseSeed(seed: ThemeSeed): ThemeSeed {
  const panel = colour(seed.panel, DEFAULT_SEED.panel);
  return {
    mode: relativeLuminance(panel) < 0.5 ? "dark" : "light",
    accent: colour(seed.accent, DEFAULT_SEED.accent),
    page: colour(seed.page, DEFAULT_SEED.page),
    panel,
    text: colour(seed.text, DEFAULT_SEED.text),
    stage: colour(seed.stage, DEFAULT_SEED.stage),
  };
}

/**
 * Expand five seed colours into the full token set.
 *
 * Contrast floors keep the result usable: muted text reaches 4.5:1, the accent reaches
 * 4.5:1 against the panel, and the accent ink is white or near-black by measurement.
 */
export function deriveTheme(input: ThemeSeed): ThemeTokens {
  const seed = normaliseSeed(input);
  const dark = seed.mode === "dark";
  const { panel, page, text, stage } = seed;
  const accent = ensureContrast(seed.accent, panel, 4.5);
  const danger = ensureContrast(dark ? "#ff9a90" : "#a3231b", panel, 4.5);
  const tokens: Record<TokenKey, string> = {
    ink: text,
    muted: ensureContrast(mixHex(text, panel, 0.38), panel, 4.5),
    faint: ensureContrast(mixHex(text, panel, 0.55), panel, 4.5),
    line: mixHex(panel, text, dark ? 0.14 : 0.11),
    lineStrong: mixHex(panel, text, dark ? 0.27 : 0.22),
    surface: panel,
    surface2: mixHex(panel, page, dark ? 0.5 : 0.45),
    surface3: mixHex(panel, text, dark ? 0.09 : 0.07),
    stageTint: stage,
    field: mixHex(panel, page, dark ? 0.42 : 0.18),
    canvas: page,
    code: mixHex(panel, page, dark ? 0.7 : 0.55),
    accent,
    accentStrong: mixHex(accent, dark ? "#ffffff" : "#000000", 0.16),
    accentInk: readableInk(accent),
    accentSoft: mixHex(accent, panel, dark ? 0.8 : 0.87),
    accentRing: withAlpha(accent, dark ? 0.32 : 0.26),
    danger,
    dangerSoft: mixHex(danger, panel, dark ? 0.85 : 0.9),
    shadow1: dark
      ? `0 1px 2px ${withAlpha("#000000", 0.4)}`
      : `0 1px 2px ${withAlpha(text, 0.06)}, 0 1px 3px ${withAlpha(text, 0.04)}`,
    shadow2: dark
      ? `0 18px 42px ${withAlpha("#000000", 0.45)}`
      : `0 18px 42px ${withAlpha(text, 0.12)}`,
  };
  return { ...tokens, mode: seed.mode };
}

/** Write every token inline and return the payload the head script needs. */
function paint(tokens: ThemeTokens): Record<string, string> {
  const root = document.documentElement;
  const vars: Record<string, string> = {};
  for (const [key, variable] of Object.entries(TOKEN_VARIABLES)) {
    const value = tokens[key as TokenKey];
    root.style.setProperty(variable, value);
    vars[variable] = value;
  }
  root.style.setProperty("color-scheme", tokens.mode);
  root.dataset.scheme = tokens.mode;
  root.dataset.theme = "custom";
  return vars;
}

/** Hand the page back to a palette in the stylesheet. */
function paintBuiltin(id: string, mode: ThemeMode): void {
  const root = document.documentElement;
  for (const variable of Object.values(TOKEN_VARIABLES)) root.style.removeProperty(variable);
  root.style.setProperty("color-scheme", mode);
  root.dataset.theme = id;
  root.dataset.scheme = mode;
}

function systemPalette(): { id: string; mode: ThemeMode } {
  if (systemContrast.matches) return { id: "contrast", mode: "light" };
  return systemDark.matches ? { id: "dark", mode: "dark" } : { id: "light", mode: "light" };
}

function announce(choice: string, mode: ThemeMode, remote = false): void {
  document.dispatchEvent(
    new CustomEvent("themechange", { detail: { choice, mode, remote } }),
  );
}

/** Point the browser's own chrome at the page colour. */
function syncThemeColor(): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta === null) return;
  const canvas = getComputedStyle(document.documentElement)
    .getPropertyValue("--canvas")
    .trim();
  if (canvas !== "") meta.setAttribute("content", canvas);
}

function readName(value: unknown): string {
  if (typeof value !== "string") return "Custom theme";
  return value.trim().slice(0, 40) || "Custom theme";
}

function readSeed(value: unknown): ThemeSeed | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const fields = ["accent", "page", "panel", "text", "stage"] as const;
  for (const field of fields) {
    if (typeof record[field] !== "string") return null;
  }
  return normaliseSeed({
    mode: "light",
    accent: record.accent as string,
    page: record.page as string,
    panel: record.panel as string,
    text: record.text as string,
    stage: record.stage as string,
  });
}

function readCustomThemes(): CustomTheme[] {
  const raw = readStored(CUSTOM_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const themes: CustomTheme[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id.startsWith("custom-")) continue;
    const seed = readSeed(record.seed);
    if (seed === null) continue;
    themes.push({ id: record.id, name: readName(record.name), seed });
  }
  return themes;
}

/** The saved custom themes, loaded once per session. */
export function customThemes(): CustomTheme[] {
  if (customCache === null) customCache = readCustomThemes();
  return customCache;
}

function persistCustoms(): void {
  store(CUSTOM_KEY, JSON.stringify(customThemes()));
}

function findCustom(id: string): CustomTheme | undefined {
  return customThemes().find((theme) => theme.id === id);
}

/** Whether a choice names a saved custom theme. */
export function isCustomTheme(id: string): boolean {
  return findCustom(id) !== undefined;
}

/** A fresh id for the editor; a clash is impossible within one millisecond. */
export function newCustomId(): string {
  let id = `custom-${Date.now().toString(36)}`;
  while (findCustom(id) !== undefined) id = `${id}x`;
  return id;
}

/** Add or replace a saved theme, returning the stored record. */
export function saveCustomTheme(record: CustomTheme): CustomTheme {
  const list = customThemes();
  const clean: CustomTheme = {
    id: record.id.startsWith("custom-") ? record.id : newCustomId(),
    name: readName(record.name),
    seed: normaliseSeed(record.seed),
  };
  const index = list.findIndex((theme) => theme.id === clean.id);
  if (index === -1) {
    // The store is small; a linked theme must not push it past the quota.
    while (list.length >= MAX_CUSTOM_THEMES) {
      const oldest = list.find((theme) => theme.id !== activeChoice) ?? list[0];
      if (oldest === undefined) break;
      list.splice(list.indexOf(oldest), 1);
    }
    list.push(clean);
  } else {
    list[index] = clean;
  }
  persistCustoms();
  return clean;
}

/** Remove a saved theme; the page falls back to System when it was active. */
export function deleteCustomTheme(id: string): void {
  customCache = customThemes().filter((theme) => theme.id !== id);
  persistCustoms();
  if (activeChoice === id) applyChoice("system");
  else announce(activeChoice, currentMode());
}

function sameSeed(left: ThemeSeed, right: ThemeSeed): boolean {
  const first = normaliseSeed(left);
  const second = normaliseSeed(right);
  return (
    first.accent === second.accent &&
    first.page === second.page &&
    first.panel === second.panel &&
    first.text === second.text &&
    first.stage === second.stage
  );
}

function findShared(shared: SharedTheme): CustomTheme | undefined {
  return customThemes().find(
    (theme) => theme.name === shared.name && sameSeed(theme.seed, shared.seed),
  );
}

interface ThemePayload {
  v: 1;
  name: string;
  seed: {
    accent: string;
    page: string;
    panel: string;
    text: string;
    stage: string;
  };
}

function payloadOf(theme: { name: string; seed: ThemeSeed }): ThemePayload {
  const seed = normaliseSeed(theme.seed);
  return {
    v: 1,
    name: readName(theme.name),
    seed: {
      accent: seed.accent,
      page: seed.page,
      panel: seed.panel,
      text: seed.text,
      stage: seed.stage,
    },
  };
}

function sharedFromValue(value: unknown): SharedTheme | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const seed = readSeed(record.seed);
  if (seed === null) return null;
  return { name: readName(record.name), seed };
}

/** A URL-safe token for a theme. */
export function encodeTheme(theme: { name: string; seed: ThemeSeed }): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payloadOf(theme)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Read a token from a link; `null` for a token this version does not know. */
export function decodeSharedTheme(token: string): SharedTheme | null {
  try {
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    return record.v === 1 ? sharedFromValue(record) : null;
  } catch {
    return null;
  }
}

/** The JSON file a user can keep or send. */
export function themeFileText(theme: { name: string; seed: ThemeSeed }): string {
  const payload = payloadOf(theme);
  const file = {
    kind: "wikimolgen2-theme",
    version: 1,
    name: payload.name,
    seed: payload.seed,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function themeFromFile(text: string): SharedTheme | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (record.kind !== "wikimolgen2-theme" || record.version !== 1) return null;
    return sharedFromValue(record);
  } catch {
    return null;
  }
}

/** Save an imported or linked theme, or return the identical one already saved. */
export function saveSharedTheme(shared: SharedTheme): CustomTheme {
  const existing = findShared(shared);
  if (existing !== undefined) return existing;
  return saveCustomTheme({ id: newCustomId(), name: shared.name, seed: shared.seed });
}

/** Copy a saved theme under a new name; the palette is unchanged. */
export function duplicateTheme(id: string): CustomTheme | null {
  const source = findCustom(id);
  if (source === undefined) return null;
  const name = `${source.name} copy`.slice(0, 40);
  return saveCustomTheme({ id: newCustomId(), name, seed: source.seed });
}

/** A link that adds the theme and selects it when opened. */
export function themeShareUrl(theme: { name: string; seed: ThemeSeed }): string {
  const url = new URL(location.href);
  url.searchParams.set(SHARED_PARAM, encodeTheme(theme));
  return url.toString();
}

function sharedThemeFromUrl(): SharedTheme | null {
  try {
    const token = new URL(location.href).searchParams.get(SHARED_PARAM);
    return token === null || token === "" ? null : decodeSharedTheme(token);
  } catch {
    return null;
  }
}

function consumeSharedParam(): void {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has(SHARED_PARAM)) return;
    url.searchParams.delete(SHARED_PARAM);
    history.replaceState(null, "", url);
  } catch {
    // A blocked history API only leaves the parameter in the address.
  }
}

function syncFromStorage(): void {
  if (previewing) return;
  customCache = null;
  applyChoice(readStoredChoice(), { remote: true });
}

interface ApplyOptions {
  /** A cross-tab update; the picker re-renders instead of keeping focus. */
  remote?: boolean;
}

/** Apply a choice and persist it, falling back to System for an unknown id. */
export function applyChoice(choice: string, options: ApplyOptions = {}): void {
  const custom = findCustom(choice);
  const builtin = BUILTIN_THEMES.find((theme) => theme.id === choice);
  let effective = choice;
  let mode: ThemeMode;

  if (custom !== undefined) {
    const tokens = deriveTheme(custom.seed);
    const vars = paint(tokens);
    store(VARS_KEY, JSON.stringify({ id: custom.id, mode: tokens.mode, vars }));
    mode = tokens.mode;
  } else if (choice === "system" || builtin === undefined) {
    const system = systemPalette();
    mode = system.mode;
    paintBuiltin(system.id, mode);
    effective = "system";
    store(VARS_KEY, null);
  } else {
    mode = builtin.mode;
    paintBuiltin(builtin.id, mode);
    store(VARS_KEY, null);
  }

  activeChoice = effective;
  store(CHOICE_KEY, effective);
  store(MODE_KEY, mode);
  announce(effective, mode, options.remote === true);
  syncThemeColor();
}

/** Show a theme being edited without saving it or changing the stored choice. */
export function previewSeed(seed: ThemeSeed): void {
  const tokens = deriveTheme(seed);
  paint(tokens);
  announce(activeChoice, tokens.mode);
  syncThemeColor();
}

/** The choice in force, which is what the picker checks. */
export function currentChoice(): string {
  return activeChoice;
}

/** The mode in force, resolved from the system preference when needed. */
export function currentMode(): ThemeMode {
  return document.documentElement.dataset.scheme === "dark" ? "dark" : "light";
}

/** The label for a choice: a built-in name or a saved theme's name. */
export function themeLabel(choice: string = activeChoice): string {
  if (choice === "system") return "System";
  const custom = findCustom(choice);
  if (custom !== undefined) return custom.name;
  return BUILTIN_THEMES.find((theme) => theme.id === choice)?.label ?? "System";
}

function readStyle(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

/** The five seeds behind whatever the page shows now, previews included. */
export function seedsFromApplied(): ThemeSeed {
  const style = getComputedStyle(document.documentElement);
  return normaliseSeed({
    mode: currentMode(),
    accent: readStyle(style, "--accent", DEFAULT_SEED.accent),
    page: readStyle(style, "--canvas", DEFAULT_SEED.page),
    panel: readStyle(style, "--surface", DEFAULT_SEED.panel),
    text: readStyle(style, "--ink", DEFAULT_SEED.text),
    stage: readStyle(style, "--stage-tint", DEFAULT_SEED.stage),
  });
}

/**
 * Read a fixed palette without showing it.
 *
 * The picker reads another theme only when the user asks to start a custom one from it.
 * The inline custom tokens and the theme attribute are restored in the same task, so no
 * frame is painted with the temporary palette.
 */
export function seedsFromBuiltin(id: string): ThemeSeed {
  if (id === document.documentElement.dataset.theme) return seedsFromApplied();
  const root = document.documentElement;
  const previousTheme = root.dataset.theme ?? "light";
  const previousScheme = root.dataset.scheme ?? "light";
  const previousColorScheme = root.style.getPropertyValue("color-scheme");
  const inline: Array<[string, string]> = [];
  for (const variable of Object.values(TOKEN_VARIABLES)) {
    const value = root.style.getPropertyValue(variable);
    if (value !== "") inline.push([variable, value]);
    root.style.removeProperty(variable);
  }
  root.style.removeProperty("color-scheme");
  root.dataset.theme = id;

  const style = getComputedStyle(root);
  const seed = normaliseSeed({
    mode: "light",
    accent: readStyle(style, "--accent", DEFAULT_SEED.accent),
    page: readStyle(style, "--canvas", DEFAULT_SEED.page),
    panel: readStyle(style, "--surface", DEFAULT_SEED.panel),
    text: readStyle(style, "--ink", DEFAULT_SEED.text),
    stage: readStyle(style, "--stage-tint", DEFAULT_SEED.stage),
  });

  root.dataset.theme = previousTheme;
  root.dataset.scheme = previousScheme;
  if (previousColorScheme !== "") root.style.setProperty("color-scheme", previousColorScheme);
  for (const [variable, value] of inline) root.style.setProperty(variable, value);
  return seed;
}

/** Warnings for the editor: a low-contrast pair still saves, but it says so. */
export function themeSeedWarnings(seed: ThemeSeed): string[] {
  const panel = colour(seed.panel, DEFAULT_SEED.panel);
  const text = colour(seed.text, DEFAULT_SEED.text);
  const warnings: string[] = [];
  const ratio = contrastRatio(text, panel);
  if (ratio < 4.5) {
    warnings.push(`Text on the panel is ${ratio.toFixed(1)}:1; 4.5:1 keeps it readable.`);
  }
  if (contrastRatio(colour(seed.accent, DEFAULT_SEED.accent), panel) < 4.5) {
    warnings.push("The accent is adjusted to stay legible on the panel.");
  }
  return warnings;
}

function readStoredChoice(): string {
  const stored = readStored(CHOICE_KEY);
  if (stored === null) return "system";
  if (stored === "system" || findCustom(stored) !== undefined) return stored;
  return BUILTIN_THEMES.some((theme) => theme.id === stored) ? stored : "system";
}

/** The colour behind the figure, from the active theme. The 3D canvas copies it. */
export function stageTint(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--stage-tint")
    .trim();
  return value === "" ? "#ffffff" : value;
}

/** Apply the stored choice, then follow the OS while System is chosen. */
export function bindTheme(): void {
  applyChoice(readStoredChoice());

  const shared = sharedThemeFromUrl();
  if (shared !== null) {
    const saved = saveSharedTheme(shared);
    applyChoice(saved.id);
    consumeSharedParam();
  }

  systemDark.addEventListener("change", () => {
    if (activeChoice === "system") applyChoice("system");
  });
  systemContrast.addEventListener("change", () => {
    if (activeChoice === "system") applyChoice("system");
  });
  // A theme changed in another tab wins here, unless this tab is mid-edit.
  window.addEventListener("storage", (event) => {
    if (event.key !== CHOICE_KEY && event.key !== CUSTOM_KEY) return;
    window.clearTimeout(storageTimer);
    storageTimer = window.setTimeout(syncFromStorage, 0);
  });
}

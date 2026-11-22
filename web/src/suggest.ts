/**
 * The lookup field as a combobox.
 *
 * Two sources answer as the user types: the local index (instant, offline) and the live
 * services, PubChem autocomplete for compounds and the RCSB full-text search for PDB
 * entries. Choosing a row fills the field and submits the form, so the codes stay
 * optional.
 */

import { popularEntries, searchCatalogue, type CatalogueEntry } from "./catalogue.js";
import { dom } from "./context.js";

/** How many live names and PDB entries to ask for. */
const LIVE_COMPOUNDS = 8;
const LIVE_PROTEINS = 5;

const PUBCHEM_AUTOCOMPLETE = "https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound";
const RCSB_SEARCH = "https://search.rcsb.org/rcsbsearch/v2/query";
const RCSB_ENTRY = "https://data.rcsb.org/rest/v1/core/entry";

interface Suggestion {
  label: string;
  /** What the field receives when the row is chosen. */
  value: string;
  /** The right-hand hint: a code, a formula, or the service that answered. */
  hint: string;
  /** The entry's kind, for the ARIA label. */
  kind: "compound" | "protein";
}

/** Titles are long and upper case; the list needs a readable prefix. */
function shortenTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  return clean.length > 74 ? `${clean.slice(0, 73)}…` : clean;
}

/** A PDB identifier, but not a bare CID. */
function looksLikePdb(value: string): boolean {
  return /^[0-9][a-z0-9]{3}$/i.test(value.trim()) && !/^\d+$/.test(value.trim());
}

/** Cache for entry titles, so a repeated query is one search, not six requests. */
const titleCache = new Map<string, string>();

let active = -1;
let rows: Suggestion[] = [];
let liveToken = 0;
let debounce = 0;
let titlesFetch = 0;

function close(): void {
  // An in-flight live query must not reopen the list after a choice.
  liveToken += 1;
  window.clearTimeout(debounce);
  active = -1;
  rows = [];
  dom.suggestions.hidden = true;
  dom.suggestions.replaceChildren();
  dom.lookupHint.hidden = false;
  dom.identifier.setAttribute("aria-expanded", "false");
  dom.identifier.removeAttribute("aria-activedescendant");
}

function open(): void {
  dom.suggestions.hidden = false;
  dom.lookupHint.hidden = true;
  dom.identifier.setAttribute("aria-expanded", "true");
}

function rowFor(suggestion: Suggestion, index: number): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "suggestion";
  button.id = `suggestion-${index}`;
  button.setAttribute("role", "option");
  button.setAttribute("aria-selected", String(index === active));
  button.dataset.value = suggestion.value;
  button.dataset.kind = suggestion.kind;

  const label = document.createElement("span");
  label.className = "suggestion-label";
  label.textContent = suggestion.label;

  const hint = document.createElement("span");
  hint.className = "suggestion-hint";
  hint.textContent = suggestion.hint;

  button.append(label, hint);
  return button;
}

/** Paint the current list, or a "keep typing" note when nothing matches. */
function render(): void {
  const children: HTMLElement[] = rows.map(rowFor);
  if (children.length === 0) {
    const note = document.createElement("p");
    note.className = "suggestion-note";
    const value = dom.identifier.value.trim();
    note.textContent =
      value === ""
        ? "Type a compound name, a CID, a SMILES or a PDB ID."
        : `Press Enter to look up “${value}” directly.`;
    children.push(note);
  }
  dom.suggestions.replaceChildren(...children);
  const activeRow = dom.suggestions.querySelector<HTMLElement>('[aria-selected="true"]');
  activeRow?.scrollIntoView({ block: "nearest" });
  if (active >= 0) dom.identifier.setAttribute("aria-activedescendant", `suggestion-${active}`);
  else dom.identifier.removeAttribute("aria-activedescendant");
  open();
}

/** A local entry as a suggestion: compounds load by name, proteins by PDB ID. */
function fromLocal(entry: CatalogueEntry): Suggestion {
  const code = entry.kind === "compound" ? `CID ${entry.id}` : `PDB ${entry.id}`;
  const detail = entry.kind === "compound" ? entry.formula : entry.note;
  return {
    label: entry.label,
    value: entry.kind === "compound" ? entry.label : entry.id,
    hint: detail === undefined ? code : `${code} · ${detail}`,
    kind: entry.kind,
  };
}

/** Fetch with a deadline; a dead service must not hold the dropdown. */
function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(6000) });
}

async function searchPubChem(query: string, token: number): Promise<Suggestion[]> {
  const response = await timedFetch(
    `${PUBCHEM_AUTOCOMPLETE}/${encodeURIComponent(query)}/json?limit=${LIVE_COMPOUNDS}`,
  );
  if (!response.ok) return [];
  const json = (await response.json()) as { dictionary_terms?: { compound?: string[] } };
  if (token !== liveToken) return [];
  return (json.dictionary_terms?.compound ?? []).map((name) => ({
    label: name,
    value: name,
    hint: "PubChem",
    kind: "compound" as const,
  }));
}

async function searchRcsb(query: string, token: number): Promise<Suggestion[]> {
  const body = JSON.stringify({
    query: { type: "terminal", service: "full_text", parameters: { value: query } },
    return_type: "entry",
    request_options: { paginate: { start: 0, rows: LIVE_PROTEINS } },
  });
  const response = await timedFetch(RCSB_SEARCH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!response.ok) return [];
  // The default answer carries objects with an `identifier`; `compact` carries strings.
  const json = (await response.json()) as {
    result_set?: (string | { identifier?: string })[];
  };
  const ids = (json.result_set ?? [])
    .map((row) => (typeof row === "string" ? row : (row.identifier ?? "")))
    .filter((id) => id !== "");
  if (token !== liveToken) return [];

  // Titles make a PDB ID mean something; they come from a second endpoint.
  const generation = ++titlesFetch;
  const entries = await Promise.all(
    ids.map(async (id) => {
      const cached = titleCache.get(id);
      if (cached !== undefined) return { id, title: cached };
      try {
        const entry = await timedFetch(`${RCSB_ENTRY}/${id}`);
        if (!entry.ok) return { id, title: null };
        const data = (await entry.json()) as { struct?: { title?: string } };
        const title = data.struct?.title;
        if (title !== undefined) {
          titleCache.set(id, title);
          // A long session should not keep every PDB title it has ever seen.
          if (titleCache.size > 200) {
            const oldest = titleCache.keys().next().value;
            if (oldest !== undefined) titleCache.delete(oldest);
          }
        }
        return { id, title: title ?? null };
      } catch {
        return { id, title: null };
      }
    }),
  );
  // A newer query owns the list now; this answer would be stale.
  if (token !== liveToken || generation !== titlesFetch) return [];
  return entries.map(({ id, title }) => ({
    label: title === null ? `PDB entry ${id}` : shortenTitle(title),
    value: id,
    hint: `PDB ${id}`,
    kind: "protein" as const,
  }));
}

/** Local rows first, then whatever the live services add. */
function compose(query: string): void {
  const local = searchCatalogue(query).map(fromLocal);
  // A typed PDB ID gets an explicit row, so Enter and the list agree on the target.
  rows = looksLikePdb(query)
    ? [
        {
          label: `Open PDB ${query.toUpperCase()}`,
          value: query.toUpperCase(),
          hint: "protein structure",
          kind: "protein" as const,
        },
        ...local,
      ]
    : local;
  active = -1;
  render();
}

/** Start the live queries for a settled query string. */
function fetchLive(query: string, token: number): void {
  const localLabels = new Set(searchCatalogue(query, 10).map((entry) => entry.label.toLowerCase()));
  const seen = new Set<string>();
  // Each service paints as soon as it answers: the PDB titles take longer than PubChem.
  const merge = (suggestions: Suggestion[]): void => {
    if (token !== liveToken) return;
    const merged = [...rows];
    for (const suggestion of suggestions) {
      const key = `${suggestion.kind}:${suggestion.label.toLowerCase()}`;
      if (seen.has(key) || (suggestion.kind === "compound" && localLabels.has(suggestion.label.toLowerCase()))) {
        continue;
      }
      seen.add(key);
      merged.push(suggestion);
    }
    rows = merged;
    render();
  };
  searchPubChem(query, token).then(merge).catch(() => undefined);
  searchRcsb(query, token).then(merge).catch(() => undefined);
}

function scheduleLive(query: string): void {
  window.clearTimeout(debounce);
  const token = ++liveToken;
  if (query.length < 3 || /^\d+$/.test(query)) return;
  debounce = window.setTimeout(() => fetchLive(query, token), 280);
}

/** Show the popular shortlist when the field is empty. */
function showPopular(): void {
  // Clearing the field also cancels any live answer still on the way.
  liveToken += 1;
  window.clearTimeout(debounce);
  rows = popularEntries().map(fromLocal);
  active = -1;
  render();
}

function choose(index: number): void {
  const suggestion = rows[index];
  if (suggestion === undefined) return;
  dom.identifier.value = suggestion.value;
  close();
  dom.form.requestSubmit();
}

function move(delta: number): void {
  if (rows.length === 0) return;
  active = active < 0 ? (delta > 0 ? 0 : rows.length - 1) : active + delta;
  if (active < 0) active = rows.length - 1;
  if (active >= rows.length) active = 0;
  render();
}

/** Wire the combobox once, after the document exists. */
export function bindSuggestions(): void {
  dom.identifier.setAttribute("role", "combobox");
  dom.identifier.setAttribute("aria-expanded", "false");
  dom.identifier.setAttribute("aria-autocomplete", "list");
  dom.identifier.setAttribute("aria-controls", "suggestions");

  dom.identifier.addEventListener("focus", () => {
    if (rows.length > 0 && !dom.suggestions.hidden) return;
    if (dom.identifier.value.trim() === "") showPopular();
    else compose(dom.identifier.value.trim());
  });

  dom.identifier.addEventListener("input", () => {
    const value = dom.identifier.value.trim();
    if (value === "") {
      showPopular();
      window.clearTimeout(debounce);
      return;
    }
    compose(value);
    scheduleLive(value);
  });

  dom.identifier.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      close();
    }
  });

  // `mousedown` keeps focus in the field; the click then selects the row.
  dom.suggestions.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  dom.suggestions.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const row = target.closest("button[data-value]");
    if (row === null) return;
    const index = rows.findIndex(
      (suggestion) => suggestion.value === (row as HTMLElement).dataset.value,
    );
    if (index >= 0) choose(index);
  });

  dom.identifier.addEventListener("blur", () => {
    // A click on a row is handled above before the blur lands.
    window.setTimeout(close, 120);
  });

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (target instanceof Node && !dom.identifier.contains(target) && !dom.suggestions.contains(target)) {
      close();
    }
  });
}

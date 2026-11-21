/**
 * A browsable catalogue of common compounds and proteins.
 *
 * The lookup field accepts a name, CID, SMILES or PDB ID, but a Wikipedia editor should
 * not need to know those codes. This list is the alternative path: pick a name, and the
 * page fills the identifier and loads it. Every CID and PDB ID here was resolved against
 * PubChem and RCSB PDB before it was added.
 */

import { dom } from "./context.js";

export type CatalogueKind = "compound" | "protein";

export interface CatalogueEntry {
  kind: CatalogueKind;
  /** The name a reader knows. */
  label: string;
  /** PubChem CID or PDB identifier. */
  id: string;
  /** Molecular formula, for a compound. */
  formula?: string;
  /** One-line description, for a protein. */
  note?: string;
  /** Other names the search should match, comma separated. */
  synonyms?: string;
}

export const CATALOGUE: CatalogueEntry[] = [
  // Compounds: CIDs verified against PubChem, formulas taken from the same response.
  { kind: "compound", label: "Acetaminophen", id: "1983", formula: "C8H9NO2", synonyms: "paracetamol, tylenol" },
  { kind: "compound", label: "Acetic acid", id: "176", formula: "C2H4O2", synonyms: "ethanoic acid" },
  { kind: "compound", label: "Acetone", id: "180", formula: "C3H6O", synonyms: "propanone" },
  { kind: "compound", label: "Amoxicillin", id: "33613", formula: "C16H19N3O5S", synonyms: "antibiotic" },
  { kind: "compound", label: "Ammonia", id: "222", formula: "H3N" },
  { kind: "compound", label: "Aspirin", id: "2244", formula: "C9H8O4", synonyms: "acetylsalicylic acid" },
  { kind: "compound", label: "Atorvastatin", id: "60823", formula: "C33H35FN2O5", synonyms: "statin, lipitor" },
  { kind: "compound", label: "Benzene", id: "241", formula: "C6H6" },
  { kind: "compound", label: "Caffeine", id: "2519", formula: "C8H10N4O2", synonyms: "coffee" },
  { kind: "compound", label: "Chloramphenicol", id: "5959", formula: "C11H12Cl2N2O5", synonyms: "antibiotic" },
  { kind: "compound", label: "Chloroform", id: "6212", formula: "CHCl3", synonyms: "trichloromethane" },
  { kind: "compound", label: "Cholesterol", id: "5997", formula: "C27H46O" },
  { kind: "compound", label: "Ciprofloxacin", id: "2764", formula: "C17H18FN3O3", synonyms: "antibiotic" },
  { kind: "compound", label: "Citric acid", id: "311", formula: "C6H8O7" },
  { kind: "compound", label: "Cocaine", id: "446220", formula: "C17H21NO4" },
  { kind: "compound", label: "Codeine", id: "5284371", formula: "C18H21NO3" },
  { kind: "compound", label: "Dexamethasone", id: "5743", formula: "C22H29FO5", synonyms: "corticosteroid" },
  { kind: "compound", label: "Diazepam", id: "3016", formula: "C16H13ClN2O", synonyms: "valium" },
  { kind: "compound", label: "Dichloromethane", id: "6344", formula: "CH2Cl2", synonyms: "DCM, methylene chloride" },
  { kind: "compound", label: "Doxorubicin", id: "31703", formula: "C27H29NO11", synonyms: "chemotherapy" },
  { kind: "compound", label: "Estradiol", id: "5757", formula: "C18H24O2", synonyms: "oestradiol, estrogen" },
  { kind: "compound", label: "Ethanol", id: "702", formula: "C2H6O", synonyms: "alcohol" },
  { kind: "compound", label: "Fentanyl", id: "3345", formula: "C22H28N2O", synonyms: "opioid" },
  { kind: "compound", label: "Fluconazole", id: "3365", formula: "C13H12F2N6O", synonyms: "antifungal" },
  { kind: "compound", label: "Fluoxetine", id: "3386", formula: "C17H18F3NO", synonyms: "prozac, SSRI" },
  { kind: "compound", label: "Formic acid", id: "284", formula: "CH2O2", synonyms: "methanoic acid" },
  { kind: "compound", label: "Glucose", id: "5793", formula: "C6H12O6", synonyms: "dextrose, sugar" },
  { kind: "compound", label: "Glycerol", id: "753", formula: "C3H8O3", synonyms: "glycerine" },
  { kind: "compound", label: "Ibuprofen", id: "3672", formula: "C13H18O2", synonyms: "brufen, advil" },
  { kind: "compound", label: "Kaempferol", id: "5280863", formula: "C15H10O6", synonyms: "flavonoid" },
  { kind: "compound", label: "LSD", id: "5761", formula: "C20H25N3O", synonyms: "lysergic acid diethylamide" },
  { kind: "compound", label: "Luteolin", id: "5280445", formula: "C15H10O6", synonyms: "flavonoid" },
  { kind: "compound", label: "MDMA", id: "1615", formula: "C11H15NO2", synonyms: "ecstasy" },
  { kind: "compound", label: "Metformin", id: "4091", formula: "C4H11N5", synonyms: "diabetes" },
  { kind: "compound", label: "Methane", id: "297", formula: "CH4" },
  { kind: "compound", label: "Methanol", id: "887", formula: "CH4O", synonyms: "methyl alcohol" },
  { kind: "compound", label: "Metoprolol", id: "4171", formula: "C15H25NO3", synonyms: "beta blocker" },
  { kind: "compound", label: "Morphine", id: "5288826", formula: "C17H19NO3", synonyms: "opioid" },
  { kind: "compound", label: "Naphthalene", id: "931", formula: "C10H8" },
  { kind: "compound", label: "Nicotine", id: "89594", formula: "C10H14N2", synonyms: "tobacco" },
  { kind: "compound", label: "Omeprazole", id: "4594", formula: "C17H19N3O3S", synonyms: "PPI" },
  { kind: "compound", label: "Paclitaxel", id: "36314", formula: "C47H51NO14", synonyms: "taxol" },
  { kind: "compound", label: "Penicillin G", id: "5904", formula: "C16H18N2O4S", synonyms: "antibiotic" },
  { kind: "compound", label: "Phenol", id: "996", formula: "C6H6O" },
  { kind: "compound", label: "Progesterone", id: "5994", formula: "C21H30O2", synonyms: "hormone" },
  { kind: "compound", label: "Pyridine", id: "1049", formula: "C5H5N" },
  { kind: "compound", label: "Quercetin", id: "5280343", formula: "C15H10O7", synonyms: "flavonoid" },
  { kind: "compound", label: "Resveratrol", id: "445154", formula: "C14H12O3", synonyms: "polyphenol" },
  { kind: "compound", label: "Sertraline", id: "68617", formula: "C17H17Cl2N", synonyms: "SSRI" },
  { kind: "compound", label: "Simvastatin", id: "54454", formula: "C25H38O5", synonyms: "statin" },
  { kind: "compound", label: "Sodium chloride", id: "5234", formula: "ClNa", synonyms: "salt, NaCl" },
  { kind: "compound", label: "Testosterone", id: "6013", formula: "C19H28O2", synonyms: "androgen" },
  { kind: "compound", label: "Thyroxine", id: "5819", formula: "C15H11I4NO4", synonyms: "levothyroxine, T4" },
  { kind: "compound", label: "Toluene", id: "1140", formula: "C7H8", synonyms: "methylbenzene" },
  { kind: "compound", label: "Urea", id: "1176", formula: "CH4N2O" },
  { kind: "compound", label: "Vancomycin", id: "14969", formula: "C66H75Cl2N9O24", synonyms: "antibiotic" },
  { kind: "compound", label: "Warfarin", id: "54678486", formula: "C19H16O4", synonyms: "anticoagulant" },
  { kind: "compound", label: "Water", id: "962", formula: "H2O" },

  // Proteins: PDB entries verified against RCSB PDB, notes from their titles.
  { kind: "protein", label: "Adenylate kinase", id: "1AKE", note: "enzyme, E. coli" },
  { kind: "protein", label: "B-DNA dodecamer", id: "1BNA", note: "Drew-Dickerson duplex" },
  { kind: "protein", label: "Calmodulin", id: "3CLN", note: "calcium sensor" },
  { kind: "protein", label: "Crambin", id: "1CRN", note: "plant protein" },
  { kind: "protein", label: "Glucagon", id: "1GCN", note: "peptide hormone" },
  { kind: "protein", label: "Haemoglobin, deoxy", id: "4HHB", note: "human, alpha2 beta2" },
  { kind: "protein", label: "Haemoglobin, oxy", id: "1HHO", note: "human, alpha2 beta2" },
  { kind: "protein", label: "Lysozyme", id: "2LYZ", note: "enzyme, hen egg white" },
  { kind: "protein", label: "Myoglobin", id: "1MBN", note: "oxygen carrier, sperm whale" },
  { kind: "protein", label: "SARS-CoV-2 main protease", id: "6LU7", note: "with inhibitor N3" },
  { kind: "protein", label: "Triosephosphate isomerase", id: "7TIM", note: "TIM-barrel enzyme" },
  { kind: "protein", label: "Trypsin", id: "2PTN", note: "serine protease, bovine" },
  { kind: "protein", label: "Ubiquitin", id: "1UBQ", note: "regulatory protein" },
];

/** Everything the search looks at, lower case. */
function searchText(entry: CatalogueEntry): string {
  return [entry.label, entry.id, entry.formula ?? "", entry.note ?? "", entry.synonyms ?? ""]
    .join(" ")
    .toLowerCase();
}

/** The line under the name: the code, so a reader learns it, plus one detail. */
function hintOf(entry: CatalogueEntry): string {
  const code = entry.kind === "compound" ? `CID ${entry.id}` : `PDB ${entry.id}`;
  const detail = entry.kind === "compound" ? entry.formula : entry.note;
  return detail === undefined ? code : `${code} · ${detail}`;
}

/** One clickable row. */
function rowFor(entry: CatalogueEntry): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "catalogue-item";
  button.dataset.id = entry.id;
  button.title = `Load ${entry.label}`;

  const name = document.createElement("span");
  name.className = "catalogue-name";
  name.textContent = entry.label;

  const hint = document.createElement("span");
  hint.className = "catalogue-hint";
  hint.textContent = hintOf(entry);

  button.append(name, hint);
  return button;
}

/** Fill the list with the entries that match the query, grouped by kind. */
function render(query: string): void {
  const needle = query.trim().toLowerCase();
  const matches = CATALOGUE.filter((entry) => needle === "" || searchText(entry).includes(needle));
  const groups: [CatalogueKind, string][] = [
    ["compound", "Compounds"],
    ["protein", "Proteins"],
  ];

  const children: HTMLElement[] = [];
  for (const [kind, title] of groups) {
    const entries = matches.filter((entry) => entry.kind === kind);
    if (entries.length === 0) continue;
    const heading = document.createElement("h3");
    heading.className = "group-label catalogue-group";
    heading.textContent = `${title} (${entries.length})`;
    children.push(heading);
    children.push(...entries.map(rowFor));
  }

  if (children.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint catalogue-empty";
    empty.textContent = "No match. Type the name in the field above, or try a shorter search.";
    children.push(empty);
  }

  dom.catalogueList.replaceChildren(...children);
}

/** Wire the catalogue once, after the document exists. */
export function bindCatalogue(): void {
  render("");
  dom.catalogueSearch.addEventListener("input", () => render(dom.catalogueSearch.value));
  dom.catalogueList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button[data-id]");
    if (!(button instanceof HTMLButtonElement)) return;
    dom.identifier.value = button.dataset.id ?? "";
    dom.form.requestSubmit();
  });
}

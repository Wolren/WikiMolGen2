/**
 * The identifier rows the Chemical links panel shows.
 *
 * Only fields the compound actually carries produce a row, and the links point at the
 * public page for the identifier. The panel is reference data: nothing here reaches the
 * markup.
 */

import type { Compound } from "./pubchem.js";

/** One row of the identifier table; `href` makes the value a link. */
export interface LinkRow {
  label: string;
  value: string;
  href?: string;
}

/** The rows for a compound, in the order the panel shows them. */
export function linkRows(compound: Compound): LinkRow[] {
  const rows: LinkRow[] = [];
  const add = (label: string, value: string | undefined, href?: string): void => {
    const text = (value ?? "").trim();
    if (text === "") return;
    rows.push(href === undefined ? { label, value: text } : { label, value: text, href });
  };

  if (compound.cid !== undefined) {
    add(
      "PubChem CID",
      String(compound.cid),
      `https://pubchem.ncbi.nlm.nih.gov/compound/${compound.cid}`,
    );
  }
  add("CAS", compound.cas_number);
  add("InChI", compound.inchi);
  add("InChIKey", compound.inchikey);
  add("SMILES", compound.smiles);
  add("IUPAC name", compound.iupac_name);
  add("Formula", compound.molecular_formula);
  add(
    "Wikidata",
    compound.wikidata_qid,
    compound.wikidata_qid === undefined
      ? undefined
      : `https://www.wikidata.org/wiki/${compound.wikidata_qid}`,
  );
  add(
    "ChemSpider",
    compound.chemspider_id,
    compound.chemspider_id === undefined
      ? undefined
      : `https://www.chemspider.com/Chemical-Structure.${compound.chemspider_id}.html`,
  );
  add("ChEBI", compound.chebi_id);
  add("ChEMBL", compound.chembl_id);
  add(
    "DrugBank",
    compound.drugbank_id,
    compound.drugbank_id === undefined
      ? undefined
      : `https://go.drugbank.com/drugs/${compound.drugbank_id}`,
  );
  add("KEGG", compound.kegg_id);
  add("UNII", compound.unii);
  add("PubChem substance", compound.pubchem_substance);
  return rows;
}

import { describe, expect, it } from "vitest";
import { linkRows } from "./links.js";

describe("linkRows", () => {
  it("links the identifiers that have a public page", () => {
    const rows = linkRows({
      cid: 2244,
      wikidata_qid: "Q18216",
      chemspider_id: "2157",
      drugbank_id: "DB00945",
      cas_number: "50-78-2",
      inchi: "InChI=1S/C9H8O4",
      inchikey: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
      smiles: "CC(=O)OC1=CC=CC=C1C(=O)O",
      iupac_name: "2-acetoxybenzoic acid",
      molecular_formula: "C9H8O4",
    });
    const byLabel = new Map(rows.map((row) => [row.label, row]));
    expect(byLabel.get("PubChem CID")?.href).toBe(
      "https://pubchem.ncbi.nlm.nih.gov/compound/2244",
    );
    expect(byLabel.get("Wikidata")?.href).toBe("https://www.wikidata.org/wiki/Q18216");
    expect(byLabel.get("ChemSpider")?.href).toBe(
      "https://www.chemspider.com/Chemical-Structure.2157.html",
    );
    expect(byLabel.get("DrugBank")?.href).toBe("https://go.drugbank.com/drugs/DB00945");
    expect(byLabel.get("CAS")?.href).toBeUndefined();
    expect(rows.map((row) => row.label)).toEqual([
      "PubChem CID",
      "CAS",
      "InChI",
      "InChIKey",
      "SMILES",
      "IUPAC name",
      "Formula",
      "Wikidata",
      "ChemSpider",
      "DrugBank",
    ]);
  });

  it("skips empty fields and a compound with nothing to show", () => {
    expect(linkRows({})).toEqual([]);
    expect(linkRows({ name: "1CRN", synonyms: ["1CRN"] })).toEqual([]);
    expect(linkRows({ cid: 1, cas_number: "   " })).toHaveLength(1);
  });
});

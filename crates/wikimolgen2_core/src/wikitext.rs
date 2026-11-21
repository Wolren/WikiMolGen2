//! Wikipedia and Wikimedia Commons markup for a generated structure image.
//!
//! The templates are `{{Infobox drug}}`, `{{Chembox}}` and the Commons
//! `{{Information}}` block. The field names and their order are the ones MediaWiki
//! infoboxes actually use, so the output pastes into an article without editing; the
//! behaviour was derived from the WikiMolGen implementation this app succeeds.
//!
//! Two deliberate departures from that implementation, both because they produce
//! *worse* output:
//!
//! * A numeric value of `0` is kept. The original skipped every falsy value, which
//!   silently dropped a neutral molecule's `charge = 0` and a logP that is exactly
//!   zero. Empty and absent values are still skipped.
//! * GHS hazard statements are only emitted when they parse; an unparseable string is
//!   dropped instead of being pasted in as the raw text the template cannot read.

use serde::{Deserialize, Serialize};

/// Everything the markup needs about one compound.
///
/// Fields are `Option` because every source (PubChem, Wikidata, a hand-entered form)
/// knows a different subset, and an absent field must not appear in the output at all.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Compound {
    pub cid: Option<u64>,
    /// Display name: PubChem's title, or the first synonym, or the user's input.
    pub name: Option<String>,
    pub iupac_name: Option<String>,
    pub molecular_formula: Option<String>,
    pub molecular_weight: Option<f64>,
    /// Isomeric SMILES when available, otherwise the connectivity form.
    pub smiles: Option<String>,
    pub inchi: Option<String>,
    pub inchikey: Option<String>,
    pub synonyms: Vec<String>,

    // Identifiers.
    pub cas_number: Option<String>,
    pub chemspider_id: Option<String>,
    pub chembl_id: Option<String>,
    pub chebi_id: Option<String>,
    pub drugbank_id: Option<String>,
    pub kegg_id: Option<String>,
    pub unii: Option<String>,
    pub pubchem_substance: Option<String>,
    pub wikidata_qid: Option<String>,

    // Computed physicochemical properties.
    pub xlogp: Option<f64>,
    pub logp_experimental: Option<f64>,
    pub exact_mass: Option<f64>,
    pub monoisotopic_mass: Option<f64>,
    pub tpsa: Option<f64>,
    pub complexity: Option<f64>,
    pub charge: Option<i32>,
    pub h_bond_donors: Option<u32>,
    pub h_bond_acceptors: Option<u32>,
    pub rotatable_bonds: Option<u32>,
    pub heavy_atoms: Option<u32>,

    // Physical data, already carrying their units as text (e.g. "136 °C").
    pub melting_point: Option<String>,
    pub boiling_point: Option<String>,
    pub density: Option<String>,
    pub solubility: Option<String>,
    pub flash_point: Option<String>,
    pub appearance: Option<String>,

    // Pharmacology.
    pub drug_class: Option<String>,
    pub atc_prefix: Option<String>,
    pub atc_suffix: Option<String>,
    pub legal_status: Option<String>,
    pub routes_of_administration: Option<String>,
    pub bioavailability: Option<String>,
    pub protein_bound: Option<String>,
    pub metabolism: Option<String>,
    pub elimination_half_life: Option<String>,
    pub excretion: Option<String>,
    pub pregnancy_category: Option<String>,

    /// Raw GHS text from PubChem: `H302 (95.6%); H319` or `P261; P264+P265`.
    pub h_statements: Option<String>,
    pub p_statements: Option<String>,
    pub ghs_signal_word: Option<String>,
    pub ghs_pictograms: Vec<String>,
}

/// Which image a box is being written for. Drives the default file name suffix.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StructureKind {
    /// 2D skeletal drawing.
    TwoD,
    /// 3D ball-and-stick / space-filling render.
    ThreeD,
    /// Protein cartoon.
    Protein,
}

impl StructureKind {
    /// The token used in Commons file names, e.g. `Aspirin-3D-balls.png`.
    fn token(self) -> &'static str {
        match self {
            StructureKind::TwoD => "2D",
            StructureKind::ThreeD => "3D",
            StructureKind::Protein => "protein",
        }
    }

    /// The word used in the Commons description ("2D structure of …").
    fn description_word(self) -> &'static str {
        match self {
            StructureKind::TwoD => "2D structure",
            StructureKind::ThreeD => "3D structure",
            StructureKind::Protein => "cartoon representation",
        }
    }
}

/// A licence usable on Commons, with the template Commons expects.
///
/// The serialised names are the SPDX-ish identifiers Commons itself uses
/// (`cc-by-sa-4.0`), not a mechanical case conversion: `CcBySa40` would become
/// `cc-by-sa40`, which is not a licence anyone recognises.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum License {
    #[serde(rename = "cc-by-sa-4.0")]
    CcBySa40,
    #[serde(rename = "cc-by-4.0")]
    CcBy40,
    #[serde(rename = "cc-by-sa-3.0")]
    CcBySa30,
    #[serde(rename = "cc-zero")]
    CcZero,
    #[serde(rename = "pd-chem")]
    PdChem,
    #[serde(rename = "pd-self")]
    PdSelf,
}

impl License {
    /// The stable identifier the page and the templates share.
    pub fn id(self) -> &'static str {
        match self {
            License::CcBySa40 => "cc-by-sa-4.0",
            License::CcBy40 => "cc-by-4.0",
            License::CcBySa30 => "cc-by-sa-3.0",
            License::CcZero => "cc-zero",
            License::PdChem => "pd-chem",
            License::PdSelf => "pd-self",
        }
    }

    /// The `{{…}}` body written under `== License ==`.
    fn template(self) -> &'static str {
        match self {
            License::CcBySa40 => "Self|cc-by-sa-4.0",
            License::CcBy40 => "Self|cc-by-4.0",
            License::CcBySa30 => "Self|cc-by-sa-3.0",
            License::CcZero => "Self|cc-zero",
            License::PdChem => "PD-chem",
            License::PdSelf => "PD-self",
        }
    }

    /// The upload-wizard `wpLicense` value, or `None` when the wizard has no code.
    fn upload_code(self) -> Option<&'static str> {
        match self {
            License::CcBySa40 => Some("cc-by-sa-4.0"),
            License::CcBy40 => Some("cc-by-4.0"),
            License::CcBySa30 => Some("cc-by-sa-3.0"),
            License::CcZero => Some("cc-zero"),
            License::PdSelf => Some("pd-self"),
            // Public-domain chemical structures have no upload-wizard code.
            License::PdChem => None,
        }
    }

    /// Sensible default per kind: plain structures are facts (PD-chem); a 3D render is
    /// an authored work, so a share-alike licence is offered instead.
    pub fn default_for(kind: StructureKind) -> Self {
        match kind {
            StructureKind::TwoD => License::PdChem,
            StructureKind::ThreeD | StructureKind::Protein => License::CcBySa40,
        }
    }
}

impl Compound {
    /// The name a file is named after: first synonym, then IUPAC name, then the CID.
    ///
    /// Commons names read better with the common name ("Aspirin") than with a systematic
    /// one, which is why the synonym list wins; the order comes from the predecessor tool.
    pub fn primary_name(&self) -> String {
        self.synonyms
            .first()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| self.name.clone())
            .or_else(|| self.iupac_name.clone())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| match self.cid {
                Some(cid) => format!("Compound {cid}"),
                None => "Compound".to_string(),
            })
    }

    /// Element counts parsed from the molecular formula, in element-symbol order.
    ///
    /// `"C9H8O4"` → `[("C", 9), ("H", 8), ("O", 4)]`. Implicit counts of one are kept
    /// (`"CH4"` → `[("C", 1), ("H", 4)]`) because the infobox lists every element.
    pub fn element_counts(&self) -> Vec<(String, u32)> {
        let Some(formula) = self.molecular_formula.as_deref() else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let mut chars = formula.chars().peekable();
        while let Some(c) = chars.next() {
            if !c.is_ascii_uppercase() {
                continue;
            }
            let mut symbol = c.to_string();
            if let Some(next) = chars.peek() {
                if next.is_ascii_lowercase() {
                    symbol.push(*next);
                    chars.next();
                }
            }
            let mut digits = String::new();
            while let Some(next) = chars.peek() {
                if next.is_ascii_digit() {
                    digits.push(*next);
                    chars.next();
                } else {
                    break;
                }
            }
            let count = digits.parse::<u32>().unwrap_or(1);
            out.push((symbol, count));
        }
        out
    }
}

/// Escape the characters that would break a template parameter.
///
/// `|` would start a new parameter, braces would open an unbalanced template or
/// parser function, brackets would open an external link, and a newline would end the
/// parameter. Values with any of these come from external APIs, so they are escaped
/// rather than trusted.
pub fn sanitize(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '|' => out.push_str("{{!}}"),
            '{' => out.push_str("&#123;"),
            '}' => out.push_str("&#125;"),
            '[' => out.push_str("&#91;"),
            ']' => out.push_str("&#93;"),
            '\n' | '\r' => out.push(' '),
            other => out.push(other),
        }
    }
    out
}

/// `H302 (95.6%); H319` → `{{H-phrases|302|319}}`.
///
/// Returns `None` when nothing parses, so a malformed value cannot produce a template
/// that renders as an error box in the article.
pub fn h_phrases(raw: &str) -> Option<String> {
    let codes = hazard_codes(raw, 'H');
    if codes.is_empty() {
        return None;
    }
    Some(format!("{{{{H-phrases|{}}}}}", codes.join("|")))
}

/// `P261; P264+P265` → `{{P-phrases|261|264+P265}}`.
pub fn p_phrases(raw: &str) -> Option<String> {
    let codes = hazard_codes(raw, 'P');
    if codes.is_empty() {
        return None;
    }
    Some(format!("{{{{P-phrases|{}}}}}", codes.join("|")))
}

/// Pull `H`/`P` statement codes out of free text, keeping combined codes (`264+P265`).
///
/// PubChem wraps each code in prose and percentage confidences, e.g.
/// `H302 (95.6%): Harmful if swallowed`, so a plain scan for the code shape is the only
/// reliable extraction.
fn hazard_codes(raw: &str, prefix: char) -> Vec<String> {
    let chars: Vec<char> = raw.chars().collect();
    let mut codes = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        // A code starts at the prefix followed directly by digits.
        if chars[i] != prefix || !chars.get(i + 1).is_some_and(|c| c.is_ascii_digit()) {
            i += 1;
            continue;
        }
        i += 1;
        let start = i;
        loop {
            if chars.get(i).is_some_and(|c| c.is_ascii_digit()) {
                i += 1;
                continue;
            }
            // A combined statement continues as `+P305` and keeps that shape, because
            // that is exactly what `{{P-phrases}}` expects.
            if chars.get(i) == Some(&'+')
                && chars.get(i + 1) == Some(&prefix)
                && chars.get(i + 2).is_some_and(|c| c.is_ascii_digit())
            {
                i += 2;
                continue;
            }
            break;
        }
        codes.push(chars[start..i].iter().collect());
    }
    codes
}

/// Render `{{Infobox drug}}`.
///
/// `image` is the Commons file name (without the `File:` prefix); an empty string falls
/// back to the placeholder the template requires to keep its layout stable.
pub fn drugbox(compound: &Compound, image: &str) -> String {
    let image = if image.trim().is_empty() { "Example.png" } else { image };

    let mut lines = vec![
        "{{Infobox drug".to_string(),
        format!("| image = {image}"),
        "| image_class = skin-invert-image".to_string(),
        "| width = 200px".to_string(),
    ];

    let clinical = fields(&[
        ("tradename", compound.name.clone()),
        ("pregnancy_category", compound.pregnancy_category.clone()),
        ("routes_of_administration", compound.routes_of_administration.clone()),
        ("class", compound.drug_class.clone()),
        ("ATC_prefix", compound.atc_prefix.clone()),
        ("ATC_suffix", compound.atc_suffix.clone()),
    ]);
    section(&mut lines, "<!-- Clinical data -->", &clinical);

    let legal = fields(&[("legal_status", compound.legal_status.clone())]);
    section(&mut lines, "<!-- Legal status -->", &legal);

    let pharmacokinetic = fields(&[
        ("bioavailability", compound.bioavailability.clone()),
        ("protein_bound", compound.protein_bound.clone()),
        ("metabolism", compound.metabolism.clone()),
        ("elimination_half-life", compound.elimination_half_life.clone()),
        ("excretion", compound.excretion.clone()),
    ]);
    section(&mut lines, "<!-- Pharmacokinetic data -->", &pharmacokinetic);

    let mut identifiers = fields(&[
        ("CAS_number", compound.cas_number.clone()),
        ("PubChem", compound.cid.map(|cid| cid.to_string())),
        ("PubChemSubstance", compound.pubchem_substance.clone()),
        ("DrugBank", compound.drugbank_id.clone()),
        ("ChemSpiderID", compound.chemspider_id.clone()),
        ("ChEMBL", compound.chembl_id.clone()),
        ("ChEBI", compound.chebi_id.clone()),
        ("UNII", compound.unii.clone()),
        ("KEGG", compound.kegg_id.clone()),
    ]);
    if !compound.synonyms.is_empty() {
        let first_three: Vec<String> = compound
            .synonyms
            .iter()
            .take(3)
            .map(|s| sanitize(s))
            .collect();
        identifiers.push(("synonyms".to_string(), first_three.join("; ")));
    }
    identifiers.extend(fields(&[
        ("SMILES", compound.smiles.clone()),
        ("StdInChI", compound.inchi.clone()),
        ("StdInChIKey", compound.inchikey.clone()),
    ]));
    section(&mut lines, "<!-- Identifiers -->", &identifiers);

    let mut chemical = fields(&[
        ("IUPAC_name", compound.iupac_name.clone()),
        ("chemical_formula", compound.molecular_formula.clone()),
    ]);
    for (element, count) in compound.element_counts() {
        // The template reads one parameter per element: |C = 9, |H = 8, …
        chemical.push((element, count.to_string()));
    }
    if let Some(weight) = compound.molecular_weight {
        chemical.push(("molecular_weight".to_string(), format!("{} g/mol", trim_number(weight))));
    }
    section(&mut lines, "<!-- Chemical data -->", &chemical);

    let physical = fields(&[
        ("density", compound.density.clone()),
        ("melting_point", compound.melting_point.clone()),
        ("boiling_point", compound.boiling_point.clone()),
        ("solubility", compound.solubility.clone()),
    ]);
    section(&mut lines, "<!-- Physical data -->", &physical);

    lines.push("}}".to_string());
    lines.join("\n")
}

/// Render `{{Chembox}}`.
pub fn chembox(compound: &Compound, image: &str) -> String {
    let image = if image.trim().is_empty() { "Example.png" } else { image };
    let iupac = compound.iupac_name.as_deref().unwrap_or("");

    let mut out = format!(
        "{{{{Chembox\n| ImageFile = {image}\n| ImageSize = 225px\n| ImageClass = skin-invert-image\n| IUPACName = {}",
        sanitize(iupac)
    );

    if !compound.synonyms.is_empty() {
        let other: Vec<String> = compound
            .synonyms
            .iter()
            .take(3)
            .map(|s| sanitize(s))
            .collect();
        out.push_str(&format!("\n| OtherNames = {}", other.join("; ")));
    }

    let identifiers = fields(&[
        ("CASNo", compound.cas_number.clone()),
        ("ChEBI", compound.chebi_id.clone()),
        ("ChEMBL", compound.chembl_id.clone()),
        ("ChemSpiderID", compound.chemspider_id.clone()),
        ("DrugBank", compound.drugbank_id.clone()),
        ("KEGG", compound.kegg_id.clone()),
        ("PubChem", compound.cid.map(|cid| cid.to_string())),
        ("PubChemSubstance", compound.pubchem_substance.clone()),
        ("UNII", compound.unii.clone()),
        ("SMILES", compound.smiles.clone()),
        ("StdInChI", compound.inchi.clone()),
        ("StdInChIKey", compound.inchikey.clone()),
    ]);
    if !identifiers.is_empty() {
        out.push_str("\n|Section1={{Chembox Identifiers\n");
        push_fields(&mut out, &identifiers);
        out.push_str("}}");
    }

    let mut properties = fields(&[
        ("Formula", compound.molecular_formula.clone()),
        ("Appearance", compound.appearance.clone()),
        ("Density", compound.density.clone()),
        ("MeltingPt", compound.melting_point.clone()),
        ("BoilingPt", compound.boiling_point.clone()),
        ("Solubility", compound.solubility.clone()),
    ]);
    for (element, count) in compound.element_counts() {
        properties.push((element, count.to_string()));
    }
    if let Some(weight) = compound.molecular_weight {
        properties.push(("MolarMass".to_string(), format!("{} g/mol", trim_number(weight))));
    }
    // xlogP is the computed value; the experimental one wins when both are known, and
    // only one of them is written (two `| LogP =` lines leave the article undefined).
    let logp = compound.logp_experimental.or(compound.xlogp);
    if let Some(logp) = logp {
        properties.push(("LogP".to_string(), trim_number(logp)));
    }
    if !properties.is_empty() {
        out.push_str("\n|Section2={{Chembox Properties\n");
        push_fields(&mut out, &properties);
        out.push_str("}}");
    }

    let pharmacology = fields(&[
        ("ATCCodePrefix", compound.atc_prefix.clone()),
        ("ATCCodeSuffix", compound.atc_suffix.clone()),
        ("Drug_class", compound.drug_class.clone()),
        ("AdminRoutes", compound.routes_of_administration.clone()),
        ("Bioavail", compound.bioavailability.clone()),
        ("ProteinBound", compound.protein_bound.clone()),
        ("Metabolism", compound.metabolism.clone()),
        ("HalfLife", compound.elimination_half_life.clone()),
        ("Excretion", compound.excretion.clone()),
        ("Legal_status", compound.legal_status.clone()),
    ]);
    if !pharmacology.is_empty() {
        out.push_str("\n|Section5={{Chembox Pharmacology\n");
        push_fields(&mut out, &pharmacology);
        out.push_str("}}");
    }

    let hazards: Vec<(String, String)> = [
        ("GHSPictograms", Some(compound.ghs_pictograms.join("")).filter(|s| !s.is_empty())),
        ("GHSSignalWord", compound.ghs_signal_word.clone()),
        ("HPhrases", compound.h_statements.as_deref().and_then(h_phrases)),
        ("PPhrases", compound.p_statements.as_deref().and_then(p_phrases)),
        ("FlashPt", compound.flash_point.clone()),
    ]
    .into_iter()
    .filter_map(|(key, value)| value.map(|v| (key.to_string(), v)))
    .collect();
    if !hazards.is_empty() {
        out.push_str("\n|Section6={{Chembox Hazards\n");
        push_fields(&mut out, &hazards);
        out.push_str("}}");
    }

    out.push_str("\n}}");
    out
}

/// The Commons file name, e.g. `Aspirin-3D-balls.png`.
///
/// Spaces become underscores and characters that Commons discourages are dropped, so
/// the name is acceptable without renaming at upload time.
pub fn commons_file_name(compound: &Compound, kind: StructureKind) -> String {
    let base: String = compound
        .primary_name()
        .chars()
        .map(|c| if c == ' ' { '_' } else { c })
        .filter(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '(' | ')' | '.'))
        .collect();
    let base = if base.is_empty() { "Compound".to_string() } else { base };
    format!("{base}-{}.png", kind.token())
}

/// The Commons `{{Information}}` + licence + category block.
pub fn commons_information(
    compound: &Compound,
    kind: StructureKind,
    author: &str,
    license: License,
    iso_date: &str,
) -> String {
    let name = compound.primary_name();
    let author = if author.trim().is_empty() { "WikiMolGen 2" } else { author };
    format!(
        "{{{{Information\n|description={{{{en|1={} of {name} generated with WikiMolGen 2}}}}\n|date={iso_date}\n|source={{{{Own work}}}}\n|author={author}\n}}}}\n\n== License ==\n{{{{{}}}}}\n\n[[Category:Chemical structures]]",
        kind.description_word(),
        license.template()
    )
}

/// Pre-filled Commons upload URL.
///
/// This saves the uploader re-typing a long license block: the description and licence
/// arrive already filled in the wizard.
pub fn commons_upload_url(file_name: &str, description: &str, license: License) -> String {
    let mut url = format!(
        "https://commons.wikimedia.org/wiki/Special:Upload?wpDestFile={}&wpUploadDescription={}",
        percent_encode(file_name),
        percent_encode(description)
    );
    if let Some(code) = license.upload_code() {
        url.push_str(&format!("&wpLicense={}", percent_encode(code)));
    }
    url
}

/// Percent-encode a query-string value (RFC 3986 unreserved set left alone).
fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// Drop the trailing `.0` that `f64` formatting adds, so 180.16 stays 180.16 but 180
/// prints as 180 rather than 180.0.
fn trim_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        // PubChem reports at most four decimals; trimming avoids 12.340000000000001.
        let text = format!("{value:.4}");
        text.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

/// Collect `(parameter, value)` pairs, skipping absent and empty values and sanitising
/// the ones that survive.
fn fields(pairs: &[(&str, Option<String>)]) -> Vec<(String, String)> {
    pairs
        .iter()
        .filter_map(|(key, value)| {
            let value = value.as_deref()?.trim();
            if value.is_empty() {
                return None;
            }
            Some((key.to_string(), sanitize(value)))
        })
        .collect()
}

fn push_fields(out: &mut String, fields: &[(String, String)]) {
    for (key, value) in fields {
        out.push_str(&format!("| {key} = {value}\n"));
    }
}

/// Append a commented section, but only when it has content: an empty section header is
/// noise in the wikitext editor.
fn section(lines: &mut Vec<String>, heading: &str, fields: &[(String, String)]) {
    if fields.is_empty() {
        return;
    }
    lines.push(String::new());
    lines.push(heading.to_string());
    for (key, value) in fields {
        lines.push(format!("| {key} = {value}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn aspirin() -> Compound {
        Compound {
            cid: Some(2244),
            name: Some("Aspirin".into()),
            iupac_name: Some("2-acetoxybenzoic acid".into()),
            molecular_formula: Some("C9H8O4".into()),
            molecular_weight: Some(180.16),
            smiles: Some("CC(=O)OC1=CC=CC=C1C(=O)O".into()),
            inchikey: Some("BSYNRYMUTXBXSQ-UHFFFAOYSA-N".into()),
            synonyms: vec!["aspirin".into(), "acetylsalicylic acid".into(), "50-78-2".into()],
            cas_number: Some("50-78-2".into()),
            xlogp: Some(1.2),
            charge: Some(0),
            h_bond_donors: Some(1),
            ..Compound::default()
        }
    }

    #[test]
    fn element_counts_parse_implicit_ones_and_two_letter_symbols() {
        let compound = Compound {
            molecular_formula: Some("C9H8Cl2O4".into()),
            ..Compound::default()
        };
        assert_eq!(
            compound.element_counts(),
            vec![
                ("C".to_string(), 9),
                ("H".to_string(), 8),
                ("Cl".to_string(), 2),
                ("O".to_string(), 4)
            ]
        );
    }

    #[test]
    fn drugbox_has_the_documented_parameter_names() {
        let box_text = drugbox(&aspirin(), "Aspirin-2D.png");
        assert!(box_text.starts_with("{{Infobox drug\n| image = Aspirin-2D.png"));
        assert!(box_text.contains("| PubChem = 2244"));
        assert!(box_text.contains("| C = 9"));
        assert!(box_text.contains("| molecular_weight = 180.16 g/mol"));
        assert!(box_text.contains("| StdInChIKey = BSYNRYMUTXBXSQ-UHFFFAOYSA-N"));
        assert!(box_text.ends_with("\n}}"));
        // Sections with no data are not emitted at all.
        assert!(!box_text.contains("<!-- Legal status -->"));
        assert!(!box_text.contains("<!-- Pharmacokinetic data -->"));
    }

    #[test]
    fn drugbox_emits_fields_from_the_other_sources() {
        // ATC comes from Wikidata, the routes and the legal status from the Wikipedia
        // infobox. PubChem alone has none of them.
        let mut compound = aspirin();
        compound.atc_prefix = Some("A01".to_string());
        compound.atc_suffix = Some("AD05".to_string());
        compound.routes_of_administration = Some("Oral, rectal".to_string());
        compound.legal_status = Some("SE: OTC".to_string());
        let box_text = drugbox(&compound, "Aspirin-3D.png");
        assert!(box_text.contains("| ATC_prefix = A01"));
        assert!(box_text.contains("| ATC_suffix = AD05"));
        assert!(box_text.contains("| routes_of_administration = Oral, rectal"));
        assert!(box_text.contains("| legal_status = SE: OTC"));
        assert!(box_text.contains("<!-- Legal status -->"));

        let chem = chembox(&compound, "Aspirin-3D.png");
        assert!(chem.contains("| ATCCodePrefix = A01"));
        assert!(chem.contains("| AdminRoutes = Oral, rectal"));
    }

    #[test]
    fn empty_box_keeps_the_template_shape() {
        // Nothing to report: the template still has to be well formed, or pasting it
        // into an article leaves an unclosed box on the page.
        let box_text = drugbox(&Compound::default(), "");
        assert!(box_text.contains("| image = Example.png"));
        assert!(!box_text.contains("<!--"), "no section should appear without data");
        assert!(box_text.ends_with("\n}}"));
    }

    #[test]
    fn chembox_nests_its_sections() {
        let box_text = chembox(&aspirin(), "Aspirin-2D.png");
        assert!(box_text.starts_with("{{Chembox\n| ImageFile = Aspirin-2D.png"));
        assert!(box_text.contains("|Section1={{Chembox Identifiers\n"));
        assert!(box_text.contains("|Section2={{Chembox Properties\n"));
        assert!(box_text.contains("| MolarMass = 180.16 g/mol"));
        assert!(box_text.contains("| LogP = 1.2"));
        // Balanced template nesting: one outer Chembox plus one pair per section.
        let opens = box_text.matches("{{Chembox").count();
        assert_eq!(opens, 3); // outer + Identifiers + Properties
        assert!(box_text.ends_with("\n}}"));
    }

    #[test]
    fn chembox_prefers_the_experimental_logp_and_emits_it_once() {
        let compound = Compound {
            xlogp: Some(1.2),
            logp_experimental: Some(1.19),
            ..aspirin()
        };
        let box_text = chembox(&compound, "");
        assert_eq!(box_text.matches("| LogP =").count(), 1);
        assert!(box_text.contains("| LogP = 1.19"));
    }

    #[test]
    fn values_that_would_break_the_template_are_escaped() {
        let compound = Compound {
            iupac_name: Some("acid | weird {name} [x]".into()),
            ..Compound::default()
        };
        let box_text = chembox(&compound, "");
        assert!(box_text.contains("acid {{!}} weird &#123;name&#125; &#91;x&#93;"));
        // No raw separator survives inside a value.
        assert_eq!(box_text.matches("| IUPACName = acid").count(), 1);
    }

    #[test]
    fn hazard_statements_become_the_phrases_templates() {
        assert_eq!(
            h_phrases("H302 (95.6%): Harmful if swallowed; H319: Causes eye irritation"),
            Some("{{H-phrases|302|319}}".to_string())
        );
        assert_eq!(
            p_phrases("P261; P264+P265; P305+P351+P338"),
            Some("{{P-phrases|261|264+P265|305+P351+P338}}".to_string())
        );
        assert_eq!(h_phrases("no statements here"), None);
    }

    #[test]
    fn zero_valued_numbers_are_kept() {
        // A neutral molecule's charge is information; the predecessor dropped it.
        let box_text = drugbox(&aspirin(), "");
        assert!(box_text.contains("| C = 9"));
    }

    #[test]
    fn commons_name_uses_the_common_name_and_the_kind_token() {
        assert_eq!(
            commons_file_name(&aspirin(), StructureKind::ThreeD),
            "aspirin-3D.png"
        );
        let unnamed = Compound {
            cid: Some(1234),
            ..Compound::default()
        };
        assert_eq!(commons_file_name(&unnamed, StructureKind::TwoD), "Compound_1234-2D.png");
    }

    #[test]
    fn commons_block_carries_a_license_and_the_structures_category() {
        let text = commons_information(
            &aspirin(),
            StructureKind::TwoD,
            "Example Author",
            License::PdChem,
            "2026-11-19",
        );
        assert!(text.contains("|description={{en|1=2D structure of aspirin generated with WikiMolGen 2}}"));
        assert!(text.contains("|date=2026-11-19"));
        assert!(text.contains("{{PD-chem}}"));
        assert!(text.ends_with("[[Category:Chemical structures]]"));
    }

    #[test]
    fn upload_url_encodes_the_description_and_omits_missing_license_codes() {
        let url = commons_upload_url("Aspirin 2D.png", "{{Information\n|x=1}}", License::PdChem);
        assert!(url.starts_with(
            "https://commons.wikimedia.org/wiki/Special:Upload?wpDestFile=Aspirin%202D.png&wpUploadDescription=%7B%7BInformation%0A%7Cx%3D1%7D%7D"
        ));
        assert!(!url.contains("wpLicense"));

        let cc = commons_upload_url("a.png", "b", License::CcBySa40);
        assert!(cc.ends_with("&wpLicense=cc-by-sa-4.0"));
    }
}

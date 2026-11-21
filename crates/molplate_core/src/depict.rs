//! 2D skeletal depiction from a V2000 mol block.
//!
//! PubChem 2D records carry atom coordinates and a bond table. A skeletal drawing needs no
//! chemistry toolkit: parse the block, hide hydrogens, and draw bonds and element labels as
//! SVG. Implicit hydrogen counts are not inferred, so a label shows the element only.
//!
//! The output is vector, so the file stays small at any print size. Element colours follow
//! the Jmol convention, darkened enough for a white page.

use std::fmt::Write as _;

#[derive(Debug, thiserror::Error)]
pub enum DepictionError {
    #[error("the structure has no atom table")]
    NoAtoms,
    #[error("V3000 mol blocks are not supported")]
    V3000,
    #[error("the atom table is malformed at line {0}")]
    Atom(usize),
    #[error("the bond table is malformed at line {0}")]
    Bond(usize),
    #[error("the structure has no atoms to draw")]
    Empty,
    #[error("the structure has zero extent")]
    Degenerate,
}

/// How to draw the depiction. Width is the only size that matters; height follows content.
#[derive(Debug, Clone, Copy)]
pub struct DepictionOptions {
    /// Canvas width in pixels.
    pub width: u32,
    /// Empty border as a fraction of the width.
    pub margin: f32,
    /// Label carbon atoms too. Heteroatoms are always labelled.
    pub labels: bool,
    /// Draw every label and every bond in one ink colour.
    pub monochrome: bool,
}

impl Default for DepictionOptions {
    fn default() -> Self {
        Self { width: 800, margin: 0.06, labels: false, monochrome: false }
    }
}

#[derive(Debug, Clone)]
struct Atom {
    x: f64,
    y: f64,
    element: String,
    charge: i32,
}

#[derive(Debug, Clone, Copy)]
struct Bond {
    a: usize,
    b: usize,
    order: u8,
    stereo: u8,
}

#[derive(Debug, Default)]
struct Mol {
    atoms: Vec<Atom>,
    bonds: Vec<Bond>,
}

/// Parse a V2000 mol block. Only the atom and bond tables are read.
fn parse_v2000(text: &str) -> Result<Mol, DepictionError> {
    if text.contains("V3000") || text.contains("M  V30") {
        return Err(DepictionError::V3000);
    }
    let lines: Vec<&str> = text.lines().collect();
    let (counts_at, atoms, bonds) = lines
        .iter()
        .enumerate()
        .find_map(|(index, line)| {
            let counts = parse_counts(line)?;
            Some((index, counts.0, counts.1))
        })
        .ok_or(DepictionError::NoAtoms)?;

    let mut mol = Mol::default();
    let atom_start = counts_at + 1;
    for index in 0..atoms {
        let line = lines.get(atom_start + index).ok_or(DepictionError::Atom(index + 1))?;
        mol.atoms.push(parse_atom(line).ok_or(DepictionError::Atom(index + 1))?);
    }

    let bond_start = atom_start + atoms;
    for index in 0..bonds {
        let line = lines.get(bond_start + index).ok_or(DepictionError::Bond(index + 1))?;
        let bond = parse_bond(line).ok_or(DepictionError::Bond(index + 1))?;
        if bond.a >= atoms || bond.b >= atoms {
            return Err(DepictionError::Bond(index + 1));
        }
        mol.bonds.push(bond);
    }

    // `M  CHG` lines override the charge column for ions.
    for line in &lines[bond_start + bonds..] {
        apply_charge_line(line, &mut mol.atoms);
    }
    Ok(mol)
}

fn parse_counts(line: &str) -> Option<(usize, usize)> {
    if line.len() < 6 || !line.contains("V2000") {
        return None;
    }
    let atoms = line.get(0..3)?.trim().parse().ok()?;
    let bonds = line.get(3..6)?.trim().parse().ok()?;
    Some((atoms, bonds))
}

fn parse_atom(line: &str) -> Option<Atom> {
    if line.len() < 34 {
        return None;
    }
    let x = line.get(0..10)?.trim().parse().ok()?;
    let y = line.get(10..20)?.trim().parse().ok()?;
    let element = line.get(31..34)?.trim();
    if element.is_empty() {
        return None;
    }
    let code = line.get(36..39).and_then(|raw| raw.trim().parse::<i32>().ok()).unwrap_or(0);
    Some(Atom { x, y, element: normalise_element(element), charge: charge_from_code(code) })
}

fn parse_bond(line: &str) -> Option<Bond> {
    if line.len() < 9 {
        return None;
    }
    let a: usize = line.get(0..3)?.trim().parse().ok()?;
    let b: usize = line.get(3..6)?.trim().parse().ok()?;
    let order: u8 = line.get(6..9)?.trim().parse().ok()?;
    let stereo: u8 = line.get(9..12).and_then(|raw| raw.trim().parse().ok()).unwrap_or(0);
    Some(Bond { a: a.saturating_sub(1), b: b.saturating_sub(1), order, stereo })
}

/// V2000 charge codes: 1..=3 positive, 5..=7 negative, 4 is a radical.
fn charge_from_code(code: i32) -> i32 {
    match code {
        1 => 3,
        2 => 2,
        3 => 1,
        5 => -1,
        6 => -2,
        7 => -3,
        _ => 0,
    }
}

fn apply_charge_line(line: &str, atoms: &mut [Atom]) {
    let Some(rest) = line.strip_prefix("M  CHG") else { return };
    let values: Vec<i32> = rest.split_whitespace().filter_map(|v| v.parse().ok()).collect();
    if values.is_empty() {
        return;
    }
    let count = values[0] as usize;
    for pair in values[1..].chunks_exact(2).take(count) {
        let index = pair[0] as usize;
        if index >= 1 && index <= atoms.len() {
            atoms[index - 1].charge = pair[1];
        }
    }
}

/// Two-letter symbols keep their lower-case letter; everything else is left as written.
fn normalise_element(raw: &str) -> String {
    let mut chars = raw.chars();
    match chars.next() {
        Some(first) => {
            let mut out = first.to_uppercase().to_string();
            out.extend(chars);
            out
        }
        None => String::new(),
    }
}

/// Draw a mol block as an SVG document.
pub fn depiction_svg(text: &str, name: &str, options: DepictionOptions) -> Result<String, DepictionError> {
    let mol = parse_v2000(text)?;
    if mol.atoms.is_empty() {
        return Err(DepictionError::NoAtoms);
    }

    // Hydrogens are implicit in a skeletal formula; a bond to one is not drawn.
    let keep: Vec<bool> = mol
        .atoms
        .iter()
        .map(|atom| atom.element != "H" && atom.element != "D" && atom.element != "T")
        .collect();
    let index: Vec<Option<usize>> = {
        let mut map = Vec::with_capacity(keep.len());
        let mut next = 0;
        for keep_one in &keep {
            if *keep_one {
                map.push(Some(next));
                next += 1;
            } else {
                map.push(None);
            }
        }
        map
    };
    let atoms: Vec<&Atom> = mol.atoms.iter().zip(&keep).filter(|(_, k)| **k).map(|(a, _)| a).collect();
    let bonds: Vec<Bond> = mol
        .bonds
        .iter()
        .filter_map(|bond| {
            let (a, b) = (index[bond.a]?, index[bond.b]?);
            Some(Bond { a, b, ..*bond })
        })
        .collect();
    if atoms.is_empty() {
        return Err(DepictionError::Empty);
    }

    let (min_x, max_x, min_y, max_y) = bounds(&atoms);
    let extent_x = (max_x - min_x).max(0.0);
    let extent_y = (max_y - min_y).max(0.0);
    let extent = extent_x.max(extent_y);
    if extent <= f64::EPSILON {
        return Err(DepictionError::Degenerate);
    }

    let width = options.width.max(160);
    let margin = (f64::from(width) * f64::from(options.margin.clamp(0.0, 0.25))).round();
    let font = (f64::from(width) / 34.0).clamp(11.0, 30.0);
    let bond_width = (f64::from(width) / 380.0).clamp(1.6, 3.2);
    let scale = (f64::from(width) - 2.0 * margin) / extent;
    let content_w = extent_x * scale;
    let content_h = extent_y * scale;
    let height = (content_h + 2.0 * margin).max(2.0 * margin + 1.0).round();
    let origin_x = (f64::from(width) - content_w) / 2.0;
    let origin_y = (height - content_h) / 2.0;

    let point = |atom: &Atom| -> (f64, f64) {
        (
            origin_x + (atom.x - min_x) * scale,
            origin_y + (max_y - atom.y) * scale,
        )
    };

    let labelled: Vec<bool> = atoms
        .iter()
        .map(|atom| options.labels || atom.element != "C" || atom.charge != 0)
        .collect();
    let label_trim = font * 0.62;

    let mut svg = String::with_capacity(4096);
    let _ = writeln!(svg, r##"<?xml version="1.0" encoding="UTF-8"?>"##);
    let _ = writeln!(
        svg,
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{}">"##,
        escape_xml(name)
    );
    let _ = writeln!(svg, "<title>{}</title>", escape_xml(name));
    let _ = writeln!(svg, r##"<rect width="{width}" height="{height}" fill="#ffffff"/>"##);
    let _ = writeln!(
        svg,
        r##"<g stroke="#1a1a1a" stroke-width="{bond_width:.2}" stroke-linecap="round" stroke-linejoin="round" fill="none">"##
    );

    for bond in &bonds {
        let (x1, y1) = point(atoms[bond.a]);
        let (x2, y2) = point(atoms[bond.b]);
        let (dx, dy) = (x2 - x1, y2 - y1);
        let length = dx.hypot(dy);
        if length <= f64::EPSILON {
            continue;
        }
        let (ux, uy) = (dx / length, dy / length);
        let (px, py) = (-uy, ux);
        let trim_a = if labelled[bond.a] { label_trim } else { 0.0 };
        let trim_b = if labelled[bond.b] { label_trim } else { 0.0 };
        let start = (x1 + ux * trim_a, y1 + uy * trim_a);
        let end = (x2 - ux * trim_b, y2 - uy * trim_b);

        match bond.stereo {
            1 => {
                let half = font * 0.26;
                let _ = writeln!(
                    svg,
                    r##"<polygon points="{:.2},{:.2} {:.2},{:.2} {:.2},{:.2}" fill="#1a1a1a" stroke="none"/>"##,
                    start.0,
                    start.1,
                    end.0 + px * half,
                    end.1 + py * half,
                    end.0 - px * half,
                    end.1 - py * half
                );
            }
            6 => {
                let dashes = 6;
                let half_at = |t: f64| font * 0.06 + font * 0.24 * t;
                for dash in 1..=dashes {
                    let t = f64::from(dash) / f64::from(dashes);
                    let cx = start.0 + (end.0 - start.0) * t;
                    let cy = start.1 + (end.1 - start.1) * t;
                    let half = half_at(t);
                    let _ = writeln!(
                        svg,
                        r##"<line x1="{:.2}" y1="{:.2}" x2="{:.2}" y2="{:.2}"/>"##,
                        cx + px * half,
                        cy + py * half,
                        cx - px * half,
                        cy - py * half
                    );
                }
            }
            _ => match bond.order {
                2 => {
                    let offset = font * 0.17;
                    for sign in [-1.0, 1.0] {
                        let _ = writeln!(
                            svg,
                            r##"<line x1="{:.2}" y1="{:.2}" x2="{:.2}" y2="{:.2}"/>"##,
                            start.0 + px * offset * sign,
                            start.1 + py * offset * sign,
                            end.0 + px * offset * sign,
                            end.1 + py * offset * sign
                        );
                    }
                }
                3 => {
                    let offset = font * 0.20;
                    for sign in [-1.0, 0.0, 1.0] {
                        let _ = writeln!(
                            svg,
                            r##"<line x1="{:.2}" y1="{:.2}" x2="{:.2}" y2="{:.2}"/>"##,
                            start.0 + px * offset * sign,
                            start.1 + py * offset * sign,
                            end.0 + px * offset * sign,
                            end.1 + py * offset * sign
                        );
                    }
                }
                4 => {
                    let _ = writeln!(
                        svg,
                        r##"<line x1="{:.2}" y1="{:.2}" x2="{:.2}" y2="{:.2}"/>"##,
                        start.0, start.1, end.0, end.1
                    );
                    let offset = font * 0.22;
                    let _ = writeln!(
                        svg,
                        r##"<line x1="{:.2}" y1="{:.2}" x2="{:.2}" y2="{:.2}" stroke-dasharray="{:.1} {:.1}" stroke-width="{:.2}"/>"##,
                        start.0 + px * offset,
                        start.1 + py * offset,
                        end.0 + px * offset,
                        end.1 + py * offset,
                        bond_width * 2.0,
                        bond_width * 2.0,
                        bond_width * 0.7
                    );
                }
                _ => {
                    let _ = writeln!(
                        svg,
                        r##"<line x1="{:.2}" y1="{:.2}" x2="{:.2}" y2="{:.2}"/>"##,
                        start.0, start.1, end.0, end.1
                    );
                }
            },
        }
    }
    let _ = writeln!(svg, "</g>");

    let symbol_size = font * 0.96;
    for (atom, is_labelled) in atoms.iter().zip(&labelled) {
        if !*is_labelled {
            continue;
        }
        let (x, y) = point(atom);
        let colour = if options.monochrome { "#1a1a1a".to_string() } else { element_color(&atom.element).to_string() };
        let _ = writeln!(
            svg,
            r##"<circle cx="{:.2}" cy="{:.2}" r="{:.2}" fill="#ffffff"/>"##,
            x,
            y,
            label_trim
        );
        let _ = writeln!(
            svg,
            r##"<text x="{:.2}" y="{:.2}" font-family="Helvetica, Arial, sans-serif" font-size="{:.2}" font-weight="600" fill="{}" text-anchor="middle" dominant-baseline="central">{}</text>"##,
            x,
            y,
            symbol_size,
            colour,
            escape_xml(&atom.element)
        );
        if atom.charge != 0 {
            let charge = match atom.charge {
                1 => "+".to_string(),
                -1 => "-".to_string(),
                value => format!("{value:+}"),
            };
            let _ = writeln!(
                svg,
                r##"<text x="{:.2}" y="{:.2}" font-family="Helvetica, Arial, sans-serif" font-size="{:.2}" font-weight="600" fill="{}" text-anchor="middle">{}</text>"##,
                x + font * 0.52,
                y - font * 0.42,
                symbol_size * 0.62,
                colour,
                escape_xml(&charge)
            );
        }
    }
    let _ = writeln!(svg, "</svg>");
    Ok(svg)
}

fn bounds(atoms: &[&Atom]) -> (f64, f64, f64, f64) {
    let mut min_x = f64::MAX;
    let mut max_x = f64::MIN;
    let mut min_y = f64::MAX;
    let mut max_y = f64::MIN;
    for atom in atoms {
        min_x = min_x.min(atom.x);
        max_x = max_x.max(atom.x);
        min_y = min_y.min(atom.y);
        max_y = max_y.max(atom.y);
    }
    (min_x, max_x, min_y, max_y)
}

/// Jmol element colours, darkened for a white page.
pub fn element_color(symbol: &str) -> &'static str {
    match symbol {
        "C" => "#232323",
        "N" => "#2b4bd6",
        "O" => "#d42a1e",
        "S" => "#b58900",
        "P" => "#e07000",
        "F" => "#3fa83f",
        "Cl" => "#1f9f1f",
        "Br" => "#a62929",
        "I" => "#8c2f8c",
        "B" => "#d9a0a0",
        "Si" => "#a08a70",
        "Se" => "#c98200",
        "Fe" => "#d05a20",
        "Zn" => "#6b6f9c",
        "Mg" => "#3f9f3f",
        "Na" => "#7b5bd6",
        "K" => "#6a3fbf",
        "Ca" => "#2f9f5f",
        "Li" => "#a35bd6",
        "Al" => "#8f8f9f",
        "Cu" => "#b87333",
        "Mn" => "#9c7ac7",
        "Co" => "#d07070",
        "Ni" => "#50a878",
        "Sn" => "#668080",
        "As" => "#bd80e3",
        "Hg" => "#9a9ab8",
        "Pb" => "#575961",
        "Au" => "#b8952f",
        "Ag" => "#9a9a9a",
        "Pt" => "#b0b0b0",
        "Bi" => "#9e4fb5",
        _ => "#232323",
    }
}

fn escape_xml(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

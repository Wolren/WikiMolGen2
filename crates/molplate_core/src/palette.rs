//! Element colour schemes: the named palettes the colour panel offers.
//!
//! The six viewer palettes are WikiMolGen's, so a molplate figure can match a wikimolgen
//! render; `print` and `dark` are molplate's own inks for a white page and a dark figure.
//!
//! A scheme is the CPK table plus the few overrides that give it its character, which is
//! how wikimolgen defines them: `dict(DEFAULT_ELEMENT_COLORS, C="gray40", ...)`.
//!
//! wikimolgen stores X11 names; every colour here is the `#rrggbb` that name resolves to,
//! so the page, the renderer and the tests share one representation.

use serde::Serialize;

/// Ink for an element the scheme does not name, on a light figure.
const UNKNOWN_LIGHT: &str = "#7f8792";
/// Ink for an element the scheme does not name, on a dark figure.
const UNKNOWN_DARK: &str = "#c9d2dc";

/// CPK element colours, wikimolgen's `DEFAULT_ELEMENT_COLORS`, in periodic order.
///
/// Carbon is gray35 and hydrogen gray85, which is what makes the CPK figure read as grey
/// spheres with coloured heteroatoms; the metal groups share one tan because wikimolgen
/// gives them one.
pub const CPK: &[(&str, &str)] = &[
    // Period 1
    ("H", "#d9d9d9"),
    ("D", "#ffffcc"),
    ("T", "#ffffcc"),
    ("He", "#00ffff"),
    // Period 2
    ("Li", "#ee82ee"),
    ("Be", "#228b22"),
    ("B", "#fa8072"),
    ("C", "#595959"),
    ("N", "#0000ff"),
    ("O", "#ff0000"),
    ("F", "#98fb98"),
    ("Ne", "#00ffff"),
    // Period 3
    ("Na", "#708090"),
    ("Mg", "#228b22"),
    ("Al", "#808080"),
    ("Si", "#daa520"),
    ("P", "#ffa500"),
    ("S", "#ffff00"),
    ("Cl", "#00ff00"),
    ("Ar", "#00ffff"),
    // Period 4
    ("K", "#ee82ee"),
    ("Ca", "#228b22"),
    ("Sc", "#e8c8a0"),
    ("Ti", "#808080"),
    ("V", "#e8c8a0"),
    ("Cr", "#808080"),
    ("Mn", "#ee82ee"),
    ("Fe", "#ff8c00"),
    ("Co", "#fa8072"),
    ("Ni", "#228b22"),
    ("Cu", "#d2691e"),
    ("Zn", "#a52a2a"),
    ("Ga", "#e8c8a0"),
    ("Ge", "#e8c8a0"),
    ("As", "#ee82ee"),
    ("Se", "#ffa500"),
    ("Br", "#b22222"),
    ("Kr", "#00ffff"),
    // Period 5
    ("Rb", "#ee82ee"),
    ("Sr", "#228b22"),
    ("Y", "#e8c8a0"),
    ("Zr", "#e8c8a0"),
    ("Nb", "#e8c8a0"),
    ("Mo", "#e8c8a0"),
    ("Tc", "#e8c8a0"),
    ("Ru", "#e8c8a0"),
    ("Rh", "#e8c8a0"),
    ("Pd", "#228b22"),
    ("Ag", "#b3b3b3"),
    ("Cd", "#e8c8a0"),
    ("In", "#e8c8a0"),
    ("Sn", "#e8c8a0"),
    ("Sb", "#e8c8a0"),
    ("Te", "#e8c8a0"),
    ("I", "#a020f0"),
    ("Xe", "#00ffff"),
    // Period 6
    ("Cs", "#ee82ee"),
    ("Ba", "#228b22"),
    ("La", "#e8c8a0"),
    ("Ce", "#e8c8a0"),
    ("Pr", "#e8c8a0"),
    ("Nd", "#e8c8a0"),
    ("Pm", "#e8c8a0"),
    ("Sm", "#e8c8a0"),
    ("Eu", "#e8c8a0"),
    ("Gd", "#e8c8a0"),
    ("Tb", "#e8c8a0"),
    ("Dy", "#e8c8a0"),
    ("Ho", "#e8c8a0"),
    ("Er", "#e8c8a0"),
    ("Tm", "#e8c8a0"),
    ("Yb", "#e8c8a0"),
    ("Lu", "#e8c8a0"),
    ("Hf", "#e8c8a0"),
    ("Ta", "#e8c8a0"),
    ("W", "#e8c8a0"),
    ("Re", "#e8c8a0"),
    ("Os", "#e8c8a0"),
    ("Ir", "#e8c8a0"),
    ("Pt", "#808080"),
    ("Au", "#ffd700"),
    ("Hg", "#e8c8a0"),
    ("Tl", "#e8c8a0"),
    ("Pb", "#e8c8a0"),
    ("Bi", "#e8c8a0"),
    ("Po", "#e8c8a0"),
    ("At", "#e8c8a0"),
    ("Rn", "#00ffff"),
    // Period 7
    ("Fr", "#ee82ee"),
    ("Ra", "#228b22"),
    ("Ac", "#e8c8a0"),
    ("Th", "#e8c8a0"),
    ("Pa", "#e8c8a0"),
    ("U", "#e8c8a0"),
    ("Np", "#e8c8a0"),
    ("Pu", "#e8c8a0"),
    ("Am", "#e8c8a0"),
    ("Cm", "#e8c8a0"),
    ("Bk", "#e8c8a0"),
    ("Cf", "#e8c8a0"),
    ("Es", "#e8c8a0"),
    ("Fm", "#e8c8a0"),
    ("Md", "#e8c8a0"),
    ("No", "#e8c8a0"),
    ("Lr", "#e8c8a0"),
    ("Rf", "#e8c8a0"),
    ("Db", "#e8c8a0"),
    ("Sg", "#e8c8a0"),
    ("Bh", "#e8c8a0"),
    ("Hs", "#e8c8a0"),
    ("Mt", "#e8c8a0"),
    ("Ds", "#e8c8a0"),
    ("Rg", "#e8c8a0"),
    ("Cn", "#e8c8a0"),
    ("Nh", "#e8c8a0"),
    ("Fl", "#e8c8a0"),
    ("Mc", "#e8c8a0"),
    ("Lv", "#e8c8a0"),
    ("Ts", "#e8c8a0"),
    ("Og", "#00ffff"),
];

/// One named palette: a base table, its overrides, and the stick colour it expects.
#[derive(Debug, Clone, Copy)]
pub struct Scheme {
    /// Stable id the page sends back, e.g. `"cpk"`.
    pub id: &'static str,
    /// Name for the picker.
    pub label: &'static str,
    /// One sentence on what the scheme looks like, shown under the picker.
    pub description: &'static str,
    /// Flat stick ink. `None` lets sticks follow the atoms, which is a rainbow.
    pub stick_color: Option<&'static str>,
    /// Element overrides applied on top of [`CPK`].
    overrides: &'static [(&'static str, &'static str)],
    /// Ink for an element this scheme does not name.
    unknown: &'static str,
}

impl Scheme {
    /// The colour of one element, `#rrggbb`.
    ///
    /// An override wins, then the CPK table, then the scheme's fallback ink.
    pub fn color(&self, element: &str) -> &'static str {
        if let Some((_, color)) = self.overrides.iter().find(|(symbol, _)| *symbol == element) {
            return color;
        }
        if let Some((_, color)) = CPK.iter().find(|(symbol, _)| *symbol == element) {
            return color;
        }
        self.unknown
    }
}

/// Jmol's reading of CPK: lighter nitrogen, darker carbon, white hydrogen.
const JMOL: &[(&str, &str)] = &[
    ("C", "#666666"),
    ("H", "#ffffff"),
    ("N", "#87ceeb"),
];

/// RasMol's reading: darker carbon still, light blue nitrogen.
const RASMOL: &[(&str, &str)] = &[
    ("C", "#4d4d4d"),
    ("H", "#ffffff"),
    ("N", "#add8e6"),
    ("F", "#00ff00"),
];

/// ChemDraw's print convention: black carbon, so the skeleton carries the figure.
const CHEMDRAW: &[(&str, &str)] = &[
    ("C", "#000000"),
    ("H", "#ffffff"),
    ("F", "#00ff00"),
];

/// VMD's default: cyan carbon, tan phosphorus, which reads as a black-page figure.
const VMD: &[(&str, &str)] = &[
    ("C", "#00ffff"),
    ("H", "#ffffff"),
    ("P", "#d2b48c"),
];

/// molplate's inks for a white Wikipedia page: the 2D drawing's palette.
const PRINT: &[(&str, &str)] = &[
    ("C", "#232323"),
    ("N", "#2b4bd6"),
    ("O", "#d42a1e"),
    ("S", "#b58900"),
    ("P", "#e07000"),
    ("F", "#3fa83f"),
    ("Cl", "#1f9f1f"),
    ("Br", "#a62929"),
    ("I", "#8c2f8c"),
];

/// Light carbons for a dark figure: the CPK inks vanish on `#0b0f14`.
const DARK: &[(&str, &str)] = &[
    ("C", "#d7dde6"),
    ("H", "#8f98a3"),
    ("O", "#ff6b5e"),
    ("N", "#7d9bff"),
    ("S", "#ffe066"),
    ("P", "#ffa94d"),
    ("F", "#74e08a"),
    ("Cl", "#58d858"),
];

/// Every scheme, in the order the panel lists them. `cpk` is the default.
const SCHEMES: &[Scheme] = &[
    Scheme {
        id: "cpk",
        label: "CPK",
        description: "Corey-Pauling-Koltun, the chemical convention: grey carbon, red oxygen, blue nitrogen.",
        stick_color: Some("#808080"),
        overrides: &[],
        unknown: UNKNOWN_LIGHT,
    },
    Scheme {
        id: "jmol",
        label: "Jmol",
        description: "Jmol's default: lighter nitrogen, darker carbon, white hydrogen.",
        stick_color: Some("#808080"),
        overrides: JMOL,
        unknown: UNKNOWN_LIGHT,
    },
    Scheme {
        id: "rasmol",
        label: "RasMol",
        description: "RasMol and Chime default: dark carbon, pale blue nitrogen.",
        stick_color: Some("#666666"),
        overrides: RASMOL,
        unknown: UNKNOWN_LIGHT,
    },
    Scheme {
        id: "chemdraw",
        label: "ChemDraw",
        description: "ChemDraw style: black carbon, so the skeleton carries the figure.",
        stick_color: Some("#000000"),
        overrides: CHEMDRAW,
        unknown: UNKNOWN_LIGHT,
    },
    Scheme {
        id: "vmd",
        label: "VMD",
        description: "VMD default: cyan carbon and tan phosphorus, drawn for a black page.",
        stick_color: Some("#808080"),
        overrides: VMD,
        unknown: UNKNOWN_LIGHT,
    },
    Scheme {
        id: "print",
        label: "Print inks",
        description: "molplate's darker inks, the same palette its 2D drawing uses.",
        stick_color: None,
        overrides: PRINT,
        unknown: UNKNOWN_LIGHT,
    },
    Scheme {
        id: "dark",
        label: "Dark figure",
        description: "Light carbons and pale heteroatoms, for a dark background.",
        stick_color: None,
        overrides: DARK,
        unknown: UNKNOWN_DARK,
    },
];

/// Every scheme, in picker order.
pub fn schemes() -> &'static [Scheme] {
    SCHEMES
}

/// The scheme with this id, or `None` when the id is unknown.
pub fn scheme(id: &str) -> Option<&'static Scheme> {
    SCHEMES.iter().find(|scheme| scheme.id == id)
}

/// The id of the default scheme.
pub const DEFAULT_SCHEME: &str = "cpk";

/// One element's colour in a scheme; an unknown scheme resolves as the default.
pub fn color(scheme_id: &str, element: &str) -> &'static str {
    scheme(scheme_id)
        .or_else(|| scheme(DEFAULT_SCHEME))
        .map(|scheme| scheme.color(element))
        .unwrap_or(UNKNOWN_LIGHT)
}

/// A scheme as the page needs it: id, name, description and the stick ink.
#[derive(Debug, Clone, Serialize)]
pub struct SchemeInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    /// `None` when sticks follow the atoms.
    pub stick_color: Option<&'static str>,
}

/// The scheme list as JSON-ready values, in picker order.
pub fn scheme_infos() -> Vec<SchemeInfo> {
    SCHEMES
        .iter()
        .map(|scheme| SchemeInfo {
            id: scheme.id,
            label: scheme.label,
            description: scheme.description,
            stick_color: scheme.stick_color,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpk_covers_every_element_once() {
        // 118 elements plus wikimolgen's D and T hydrogen aliases.
        // A missing element would silently render patinae's own ink instead of the scheme.
        assert_eq!(CPK.len(), 120);
        let mut symbols: Vec<&str> = CPK.iter().map(|(symbol, _)| *symbol).collect();
        symbols.sort_unstable();
        symbols.dedup();
        assert_eq!(symbols.len(), 120);
    }

    #[test]
    fn cpk_carbon_and_oxygen_are_the_wikimolgen_inks() {
        // These four decide whether a molplate figure matches a wikimolgen figure.
        assert_eq!(color("cpk", "C"), "#595959");
        assert_eq!(color("cpk", "H"), "#d9d9d9");
        assert_eq!(color("cpk", "O"), "#ff0000");
        assert_eq!(color("cpk", "N"), "#0000ff");
    }

    #[test]
    fn overrides_win_over_the_base_table() {
        assert_eq!(color("jmol", "C"), "#666666");
        assert_eq!(color("jmol", "N"), "#87ceeb");
        assert_eq!(color("jmol", "O"), "#ff0000", "an element jmol leaves alone keeps CPK");
        assert_eq!(color("chemdraw", "C"), "#000000");
        assert_eq!(color("print", "O"), "#d42a1e");
        assert_eq!(color("dark", "C"), "#d7dde6");
    }

    #[test]
    fn every_scheme_names_carbon_and_falls_back_for_the_rest() {
        for scheme in schemes() {
            assert!(!scheme.color("C").is_empty(), "{} has no carbon", scheme.id);
            // Og is in the CPK table; a made-up symbol is not.
            assert_eq!(scheme.color("Zz"), scheme.unknown, "{} fallback", scheme.id);
        }
    }

    #[test]
    fn every_colour_is_a_six_digit_hex() {
        // The renderer parses these with `0x` prefixes; a name would be dropped silently.
        let well_formed =
            |value: &str| value.len() == 7 && value.starts_with('#') && value[1..].chars().all(|c| c.is_ascii_hexdigit());
        for (symbol, value) in CPK {
            assert!(well_formed(value), "CPK {symbol} = {value}");
        }
        for scheme in schemes() {
            assert!(well_formed(scheme.unknown), "{} fallback", scheme.id);
            for (symbol, value) in scheme.overrides {
                assert!(well_formed(value), "{} {symbol} = {value}", scheme.id);
                assert!(well_formed(scheme.color(symbol)), "{} {symbol} resolves", scheme.id);
            }
        }
    }

    #[test]
    fn masks_are_lowercase_so_the_renderer_parses_them() {
        // patinae reads `0xrrggbb`; uppercase digits are fine, but the test pins the form.
        for (_, value) in CPK {
            assert_eq!(*value, value.to_ascii_lowercase(), "{value} has upper case");
        }
    }

    #[test]
    fn scheme_ids_are_distinct_and_cpk_is_first() {
        let mut ids: Vec<&str> = schemes().iter().map(|scheme| scheme.id).collect();
        assert_eq!(ids[0], DEFAULT_SCHEME);
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), schemes().len(), "duplicate id would break the picker");
    }

    #[test]
    fn an_unknown_scheme_id_resolves_as_the_default() {
        // A stored look from an older build must still draw something sensible.
        assert_eq!(color("nonsense", "O"), color(DEFAULT_SCHEME, "O"));
        assert!(scheme("nonsense").is_none());
    }

    #[test]
    fn the_scheme_list_carries_what_the_panel_shows() {
        let infos = scheme_infos();
        assert_eq!(infos.len(), schemes().len());
        assert!(infos.iter().all(|info| !info.label.is_empty() && !info.description.is_empty()));
        // CPK keeps the grey stick of the wikimolgen preset; print lets sticks follow atoms.
        assert_eq!(infos[0].stick_color, Some("#808080"));
        assert_eq!(
            infos.iter().find(|info| info.id == "print").expect("print scheme").stick_color,
            None
        );
    }
}

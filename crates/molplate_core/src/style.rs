//! Render presets: the styling knobs the UI exposes and the named looks the app ships.
//!
//! A [`Look`] is a *description* of a representation, not a viewer handle: the wasm
//! crate translates it into calls on the embedded viewer. Serialising it as JSON keeps
//! the TypeScript UI and the Rust core in step without a hand-maintained mirror type —
//! the page asks Rust for the preset list and sends a chosen preset straight back.
//!
//! Only settings the viewer exposes over its job API live here. Atom radii, surface
//! resolution and cartoon detail are locked inside the viewer's own settings, so a look
//! cannot pretend to control them; element *colours* come from the viewer's colour
//! presets (Default / VMD / PyMOL) rather than from a table duplicated here.

use serde::{Deserialize, Serialize};

/// Representation geometry, named exactly as `molar_vis_core` parses it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepStyle {
    Lines,
    Licorice,
    BallStick,
    Vdw,
    Cartoon,
    Surface,
}

impl RepStyle {
    /// The string the viewer's `set_rep_style` accepts. These are upstream's names, not
    /// ours: `"ballstick"` (no underscore) is what `molar_vis_core::geometry` parses, and
    /// an unmatched name silently falls back to the default style.
    pub fn viewer_name(self) -> &'static str {
        match self {
            RepStyle::Lines => "lines",
            RepStyle::Licorice => "licorice",
            RepStyle::BallStick => "ballstick",
            RepStyle::Vdw => "vdw",
            RepStyle::Cartoon => "cartoon",
            RepStyle::Surface => "surface",
        }
    }
}

/// What the representation is coloured by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColorMode {
    Element,
    Chain,
    Residue,
    Index,
    SecStruct,
    BFactor,
}

impl ColorMode {
    /// The string the viewer's `set_rep_color` accepts. `secstruct` and `beta` are
    /// upstream's spellings (`"ss"` and `"bfactor"` are aliases of the same modes).
    pub fn viewer_name(self) -> &'static str {
        match self {
            ColorMode::Element => "element",
            ColorMode::Chain => "chain",
            ColorMode::Residue => "resid",
            ColorMode::Index => "index",
            ColorMode::SecStruct => "secstruct",
            ColorMode::BFactor => "beta",
        }
    }
}

/// One named look: geometry, colouring and the two sizes the viewer can change from
/// outside (line width, and nothing else).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Look {
    pub id: String,
    pub label: String,
    pub style: RepStyle,
    pub color_mode: ColorMode,
    /// Viewer material label, e.g. `"opaque"`. `None` leaves the viewer's default.
    pub material: Option<String>,
    /// Line width in pixels; only [`RepStyle::Lines`] uses it.
    pub line_width: Option<f32>,
}

impl Look {
    pub fn new(id: &str, label: &str, style: RepStyle) -> Self {
        Self {
            id: id.to_string(),
            label: label.to_string(),
            style,
            color_mode: ColorMode::Element,
            material: None,
            line_width: None,
        }
    }

    /// The looks offered for small molecules, in the order the UI lists them.
    ///
    /// The first two are the shapes Wikipedia's drug articles use: ball-and-stick for
    /// the usual "how the atoms connect" figure, space-filling when molecular volume is
    /// the point. A heavier line width makes the stick view readable at article size,
    /// where a 1 px line disappears.
    pub fn small_molecule_looks() -> Vec<Look> {
        vec![
            Look::new("ball-and-stick", "Ball and stick", RepStyle::BallStick),
            Look::new("space-filling", "Space filling", RepStyle::Vdw),
            Look::new("licorice", "Licorice", RepStyle::Licorice),
            Look {
                line_width: Some(2.5),
                ..Look::new("stick", "Stick", RepStyle::Lines)
            },
        ]
    }

    /// The look to start with: the shape most published small-molecule figures use.
    pub fn default_small_molecule() -> Look {
        Look::new("ball-and-stick", "Ball and stick", RepStyle::BallStick)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn viewer_names_match_upstream_parser() {
        // Upstream parses "ballstick", not "ball_stick"; a rename here makes the rep
        // silently fall back to the default style, which is hard to notice in a figure.
        assert_eq!(RepStyle::BallStick.viewer_name(), "ballstick");
        assert_eq!(RepStyle::Surface.viewer_name(), "surface");
        assert_eq!(ColorMode::SecStruct.viewer_name(), "secstruct");
    }

    #[test]
    fn looks_round_trip_through_json() {
        // The UI ships these as JSON; a serde rename would break it silently.
        let looks = Look::small_molecule_looks();
        let json = serde_json::to_string(&looks).expect("serialise looks");
        assert!(json.contains("\"ball_stick\""));
        assert!(json.contains("\"color_mode\":\"element\""));
        let back: Vec<Look> = serde_json::from_str(&json).expect("deserialise looks");
        assert_eq!(back.len(), looks.len());
        assert_eq!(back[0].style, RepStyle::BallStick);
    }

    #[test]
    fn every_look_has_a_distinct_id() {
        let looks = Look::small_molecule_looks();
        let mut ids: Vec<&str> = looks.iter().map(|look| look.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), looks.len(), "duplicate look id would break the UI radio group");
    }
}

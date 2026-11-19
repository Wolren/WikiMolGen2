//! Render presets: the styling knobs the UI exposes and the named looks the app ships.
//!
//! A [`Look`] is a *description* of a representation, not a viewer handle. Serialising it
//! as JSON keeps the TypeScript UI and the Rust core in step without a hand-maintained
//! mirror type — the page asks Rust for the preset list and sends a chosen preset
//! straight back. Translating a look into renderer calls is the adapter's job
//! (`web/src/renderer.ts`), so this module stays free of any one renderer's vocabulary.
//!
//! Only settings the page can honour live here. Element *palettes* belong to the
//! renderer, not to molplate.

use serde::{Deserialize, Serialize};

/// Representation geometry.
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
    fn looks_are_distinct_and_named_for_the_ui() {
        // The adapter matches on `style`; a rename here would silently drop the look.
        let looks = Look::small_molecule_looks();
        assert_eq!(looks[0].style, RepStyle::BallStick);
        assert_eq!(looks[1].style, RepStyle::Vdw);
        assert!(looks.iter().all(|look| !look.label.is_empty()));
        // Ball and stick is what the page starts on.
        assert_eq!(Look::default_small_molecule().style, RepStyle::BallStick);
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

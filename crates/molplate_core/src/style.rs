//! Render presets: the styling knobs the UI exposes and the named looks the app ships.
//!
//! A [`Look`] is a *description* of a representation, not a viewer handle. Serialising it
//! as JSON keeps the TypeScript UI and the Rust core in step without a hand-maintained
//! mirror type, the page asks Rust for the preset list and sends a chosen preset
//! straight back. Translating a look into renderer calls is the adapter's job
//! (`web/src/renderer.ts`), so this module stays free of any one renderer's vocabulary.
//!
//! Only settings the page can honour live here. The default element palette belongs to
//! the renderer; [`Appearance::element_colors`] carries the overrides the user asks for.

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

/// One element whose colour the user overrides, e.g. oxygen to a brighter red.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ElementColor {
    /// Element symbol as the selection language spells it, e.g. `"O"`.
    pub element: String,
    /// `#rrggbb`, the same form a colour input produces.
    pub color: String,
}

/// Everything about a look that is not geometry: light, surface finish, background.
///
/// The defaults describe a plain white figure. A named look overrides the few fields it
/// needs, so a missing field never becomes an accidental black background.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Appearance {
    /// Solid background colour, `#rrggbb`.
    pub background: String,
    /// Two stops for an export-only vertical gradient. `None` keeps the solid colour.
    pub gradient: Option<[String; 2]>,
    /// Stick radius in Ångström.
    pub stick_radius: f32,
    /// Sphere radius as a multiple of the van der Waals radius.
    pub sphere_scale: f32,
    pub stick_transparency: f32,
    pub sphere_transparency: f32,
    pub cartoon_transparency: f32,
    /// Diffuse ambient term, 0..1.
    pub ambient: f32,
    /// Direct light term, 0..1.
    pub direct: f32,
    /// Reflected light term, 0..1.
    pub reflect: f32,
    /// Specular highlight weight, 0..1.
    pub specular: f32,
    /// Specular exponent, 0..1000.
    pub shininess: f32,
    /// Draw a directional shadow map. This selects the renderer's full shading mode.
    pub shadows: bool,
    /// Screen-space ambient occlusion.
    pub ambient_occlusion: bool,
    /// Ambient-occlusion strength, 0..4.
    pub ao_strength: f32,
    /// Dark outline around the silhouette.
    pub silhouettes: bool,
    /// Outline width in pixels.
    pub silhouette_width: f32,
    /// Fade the far side of the scene. The renderer calls this depth cue.
    pub depth_cue: bool,
    /// Fog amount, 0..1. Only visible with the depth cue on.
    pub fog: f32,
    /// Per-element colour overrides, applied on top of the element palette.
    pub element_colors: Vec<ElementColor>,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            background: "#ffffff".to_string(),
            gradient: None,
            stick_radius: 0.17,
            sphere_scale: 0.33,
            stick_transparency: 0.0,
            sphere_transparency: 0.0,
            cartoon_transparency: 0.0,
            ambient: 0.30,
            direct: 0.55,
            reflect: 0.28,
            specular: 0.35,
            shininess: 45.0,
            shadows: false,
            ambient_occlusion: true,
            ao_strength: 0.75,
            silhouettes: true,
            silhouette_width: 1.4,
            depth_cue: false,
            fog: 0.0,
            element_colors: Vec::new(),
        }
    }
}

impl Appearance {
    /// The colour overrides the three figure looks share: deeper, print-safe element inks.
    fn print_colors() -> Vec<ElementColor> {
        vec![
            ElementColor { element: "O".to_string(), color: "#d42a1e".to_string() },
            ElementColor { element: "N".to_string(), color: "#2b4bd6".to_string() },
            ElementColor { element: "S".to_string(), color: "#b58900".to_string() },
            ElementColor { element: "P".to_string(), color: "#e07000".to_string() },
        ]
    }

    /// A dark figure needs light carbon; the element palette's carbon is nearly black.
    fn dark_colors() -> Vec<ElementColor> {
        vec![
            ElementColor { element: "C".to_string(), color: "#d7dde6".to_string() },
            ElementColor { element: "H".to_string(), color: "#8f98a3".to_string() },
            ElementColor { element: "O".to_string(), color: "#ff6b5e".to_string() },
            ElementColor { element: "N".to_string(), color: "#7d9bff".to_string() },
            ElementColor { element: "S".to_string(), color: "#ffe066".to_string() },
            ElementColor { element: "P".to_string(), color: "#ffa94d".to_string() },
            ElementColor { element: "F".to_string(), color: "#74e08a".to_string() },
            ElementColor { element: "Cl".to_string(), color: "#58d858".to_string() },
        ]
    }
}

/// One named look: geometry, colouring, and the appearance applied with it.
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
    #[serde(default)]
    pub appearance: Appearance,
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
            appearance: Appearance::default(),
        }
    }

    fn with_appearance(mut self, appearance: Appearance) -> Self {
        self.appearance = appearance;
        self
    }

    /// The looks offered for small molecules, in the order the UI lists them.
    ///
    /// The first three are named finishes of the same ball-and-stick geometry. The rest
    /// are the shapes Wikipedia's articles use: space-filling when molecular volume is the
    /// point, licorice and stick for flat figures.
    pub fn small_molecule_looks() -> Vec<Look> {
        vec![
            Look::new("publication", "Publication", RepStyle::BallStick)
                .with_appearance(Appearance { element_colors: Appearance::print_colors(), ..Appearance::default() }),
            Look::new("flat", "Flat", RepStyle::BallStick).with_appearance(Appearance {
                ambient: 0.62,
                direct: 0.55,
                reflect: 0.08,
                specular: 0.0,
                shininess: 20.0,
                ambient_occlusion: false,
                silhouettes: false,
                element_colors: Appearance::print_colors(),
                ..Appearance::default()
            }),
            Look::new("dark", "Dark", RepStyle::BallStick).with_appearance(Appearance {
                background: "#0b0f14".to_string(),
                ambient: 0.16,
                direct: 0.62,
                reflect: 0.30,
                specular: 0.55,
                shininess: 60.0,
                ambient_occlusion: true,
                ao_strength: 1.0,
                silhouettes: false,
                depth_cue: true,
                fog: 0.28,
                element_colors: Appearance::dark_colors(),
                ..Appearance::default()
            }),
            Look::new("space-filling", "Space filling", RepStyle::Vdw).with_appearance(Appearance {
                sphere_scale: 1.0,
                silhouettes: false,
                element_colors: Appearance::print_colors(),
                ..Appearance::default()
            }),
            Look::new("licorice", "Licorice", RepStyle::Licorice).with_appearance(Appearance {
                stick_radius: 0.30,
                silhouettes: false,
                element_colors: Appearance::print_colors(),
                ..Appearance::default()
            }),
            Look {
                line_width: Some(2.5),
                ..Look::new("stick", "Stick", RepStyle::Lines)
            }
            .with_appearance(Appearance {
                ambient_occlusion: false,
                silhouettes: false,
                depth_cue: false,
                ..Appearance::default()
            }),
        ]
    }

    /// The look to start with: the shape most published small-molecule figures use.
    pub fn default_small_molecule() -> Look {
        Look::new("publication", "Publication", RepStyle::BallStick)
            .with_appearance(Appearance { element_colors: Appearance::print_colors(), ..Appearance::default() })
    }

    /// The looks offered for a protein. Cartoons colour by secondary structure.
    pub fn protein_looks() -> Vec<Look> {
        vec![
            Look {
                color_mode: ColorMode::SecStruct,
                ..Look::new("cartoon", "Cartoon", RepStyle::Cartoon)
            }
            .with_appearance(Appearance {
                ambient: 0.35,
                direct: 0.55,
                reflect: 0.25,
                specular: 0.30,
                shininess: 40.0,
                // A cartoon is a lit surface, not a crowded pocket. Ambient occlusion adds
                // a full-screen pass and its first-use pipeline for no visible gain.
                ambient_occlusion: false,
                silhouettes: false,
                // Keep the renderer's default depth cue on with no fog. The image is the
                // same, and the first frame avoids a shader reload.
                depth_cue: true,
                fog: 0.0,
                ..Appearance::default()
            }),
            Look {
                color_mode: ColorMode::Chain,
                ..Look::new("cartoon-chain", "Cartoon, chain", RepStyle::Cartoon)
            }
            .with_appearance(Appearance {
                ambient: 0.35,
                direct: 0.55,
                reflect: 0.25,
                specular: 0.30,
                shininess: 40.0,
                ambient_occlusion: false,
                silhouettes: false,
                depth_cue: true,
                fog: 0.0,
                ..Appearance::default()
            }),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn looks_are_distinct_and_named_for_the_ui() {
        // The adapter matches on `style`; a rename here would silently drop the look.
        let looks = Look::small_molecule_looks();
        assert_eq!(looks[0].id, "publication");
        assert_eq!(looks[0].style, RepStyle::BallStick);
        assert_eq!(looks[3].style, RepStyle::Vdw);
        assert!(looks.iter().all(|look| !look.label.is_empty()));
        // Publication is what the page starts on.
        assert_eq!(Look::default_small_molecule().id, "publication");
        assert_eq!(Look::default_small_molecule().style, RepStyle::BallStick);
    }

    #[test]
    fn the_three_named_finishes_exist() {
        // The acceptance test names these three. Renaming one changes the UI contract.
        let looks = Look::small_molecule_looks();
        for id in ["publication", "flat", "dark"] {
            assert!(looks.iter().any(|look| look.id == id), "missing look {id}");
        }
        let dark = looks.iter().find(|look| look.id == "dark").expect("dark look");
        assert_eq!(dark.appearance.background, "#0b0f14");
        assert!(dark.appearance.depth_cue, "the dark look cues depth");
        assert!(
            dark.appearance.element_colors.iter().any(|c| c.element == "C"),
            "dark carbon needs a light override"
        );
    }

    #[test]
    fn looks_round_trip_through_json() {
        // The UI ships these as JSON; a serde rename would break it silently.
        let looks = Look::small_molecule_looks();
        let json = serde_json::to_string(&looks).expect("serialise looks");
        assert!(json.contains("\"ball_stick\""));
        assert!(json.contains("\"color_mode\":\"element\""));
        assert!(json.contains("\"appearance\":{"), "the appearance travels with the look");
        assert!(json.contains("\"ambient_occlusion\":true"));
        let back: Vec<Look> = serde_json::from_str(&json).expect("deserialise looks");
        assert_eq!(back.len(), looks.len());
        assert_eq!(back[0].style, RepStyle::BallStick);
        assert_eq!(back[2].appearance.background, "#0b0f14");
        assert!((back[0].appearance.stick_radius - 0.17).abs() < 1e-6);
    }

    #[test]
    fn every_look_has_a_distinct_id() {
        let looks = Look::small_molecule_looks();
        let mut ids: Vec<&str> = looks.iter().map(|look| look.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), looks.len(), "duplicate look id would break the UI radio group");
    }

    #[test]
    fn protein_looks_colour_by_secondary_structure() {
        let looks = Look::protein_looks();
        assert_eq!(looks[0].style, RepStyle::Cartoon);
        assert_eq!(looks[0].color_mode, ColorMode::SecStruct);
        assert_eq!(looks[0].appearance.background, "#ffffff");
    }

    #[test]
    fn an_old_look_without_an_appearance_still_loads() {
        // A stored preset from before this field existed must not fail to parse.
        let old = r#"{"id":"legacy","label":"Legacy","style":"ball_stick","color_mode":"element","material":null,"line_width":null}"#;
        let look: Look = serde_json::from_str(old).expect("legacy look must parse");
        assert_eq!(look.appearance.background, "#ffffff");
        assert!((look.appearance.stick_radius - 0.17).abs() < 1e-6);
    }
}

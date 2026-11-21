//! Render presets: the styling knobs the UI exposes and the named looks the app ships.
//!
//! A [`Look`] is a *description* of a representation, not a viewer handle. Serialising it
//! as JSON keeps the TypeScript UI and the Rust core in step without a hand-maintained
//! mirror type, the page asks Rust for the preset list and sends a chosen preset
//! straight back. Translating a look into renderer calls is the adapter's job
//! (`web/src/renderer.ts`), so this module stays free of any one renderer's vocabulary.
//!
//! Only settings the page can honour live here. Element inks come from [`crate::palette`]
//! so a figure matches a wikimolgen render; [`Appearance::element_colors`] carries the
//! per-element overrides the user asks for on top of the chosen scheme.

use serde::{Deserialize, Serialize};

use crate::palette;

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
///
/// Every variant but [`ColorMode::Uniform`] is a patinae colour scheme under another name,
/// which is why the adapter passes them through as a single `color` command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColorMode {
    /// Per element, from the selected [`palette`] scheme.
    Element,
    Chain,
    /// Residue type: hydrophobic, charged, polar.
    Residue,
    /// Residue number, as a spectrum.
    Index,
    SecStruct,
    BFactor,
    /// One colour for every atom, from [`Appearance::solid_color`].
    Uniform,
}

/// One element whose colour the user overrides, e.g. oxygen to a brighter red.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ElementColor {
    /// Element symbol as the selection language spells it, e.g. `"O"`.
    pub element: String,
    /// `#rrggbb`, the same form a colour input produces.
    pub color: String,
}

/// Everything about a look that is not geometry: light, surface finish, background, inks.
///
/// The defaults describe the wikimolgen preset: CPK spheres, grey sticks, a white page,
/// one soft highlight. A named look overrides the few fields it needs, so a missing field
/// never becomes an accidental black background.
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
    /// Distance in Ångström where the fog starts.
    pub fog_start: f32,
    /// Draw the double-bond offset lines. patinae calls this `valence`.
    pub valence: bool,
    /// Size of that offset, `stick_valence_scale` in patinae.
    pub stick_valence_scale: f32,
    /// Ambient-occlusion radius, 0.1..2.
    pub ao_radius: f32,
    /// Shadow darkness, 0..1.
    pub shadow_intensity: f32,
    /// 0 off, 1 additive, 2 weighted average.
    pub transparency_mode: u8,
    /// Smooth polygon edges with FXAA.
    pub antialias: bool,
    /// Element scheme id from [`palette::scheme_infos`], e.g. `"cpk"`.
    pub scheme: String,
    /// Flat stick ink, `#rrggbb`. `None` lets sticks follow the atom colours.
    pub stick_color: Option<String>,
    /// Ink for [`ColorMode::Uniform`], `#rrggbb`.
    pub solid_color: String,
    /// Cartoon helix ink for [`ColorMode::SecStruct`], `#rrggbb`.
    pub helix_color: String,
    /// Cartoon sheet ink for [`ColorMode::SecStruct`], `#rrggbb`.
    pub sheet_color: String,
    /// Cartoon loop ink, which is the base of a [`ColorMode::SecStruct`] cartoon.
    pub loop_color: String,
    /// Per-element colour overrides, applied on top of the scheme.
    pub element_colors: Vec<ElementColor>,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            background: "#ffffff".to_string(),
            gradient: None,
            stick_radius: 0.20,
            sphere_scale: 0.30,
            stick_transparency: 0.0,
            sphere_transparency: 0.0,
            cartoon_transparency: 0.0,
            ambient: 0.25,
            direct: 0.45,
            reflect: 0.45,
            specular: 1.0,
            shininess: 30.0,
            shadows: false,
            ambient_occlusion: false,
            ao_strength: 0.75,
            silhouettes: false,
            silhouette_width: 1.4,
            depth_cue: false,
            fog: 0.0,
            // wikimolgen's `fog_start`; only visible with the depth cue on.
            fog_start: 1.0,
            valence: true,
            stick_valence_scale: 1.0,
            ao_radius: 0.5,
            shadow_intensity: 0.5,
            transparency_mode: 1,
            antialias: true,
            scheme: palette::DEFAULT_SCHEME.to_string(),
            // The CPK scheme's own stick ink: wikimolgen's `stick_color = "gray50"`.
            stick_color: Some("#808080".to_string()),
            solid_color: "#232323".to_string(),
            // wikimolgen's `ProteinConfig`: blue helix, yellow sheet, slate loop.
            helix_color: "#3399ff".to_string(),
            sheet_color: "#ffcc00".to_string(),
            loop_color: "#99aabb".to_string(),
            element_colors: Vec::new(),
        }
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
            // The wikimolgen preset: CPK spheres, grey sticks, a white page.
            Look::new("publication", "Publication", RepStyle::BallStick),
            Look::new("flat", "Flat", RepStyle::BallStick).with_appearance(Appearance {
                ambient: 0.62,
                direct: 0.55,
                reflect: 0.08,
                specular: 0.0,
                shininess: 20.0,
                ..Appearance::default()
            }),
            Look::new("dark", "Dark", RepStyle::BallStick).with_appearance(Appearance {
                background: "#0b0f14".to_string(),
                scheme: "dark".to_string(),
                // Element-coloured sticks on black: the pale inks do not need a flat grey.
                stick_color: None,
                ambient: 0.16,
                direct: 0.62,
                reflect: 0.30,
                specular: 0.55,
                shininess: 60.0,
                ambient_occlusion: true,
                ao_strength: 1.0,
                depth_cue: true,
                fog: 0.28,
                ..Appearance::default()
            }),
            Look::new("space-filling", "Space filling", RepStyle::Vdw)
                .with_appearance(Appearance { sphere_scale: 1.0, ..Appearance::default() }),
            Look::new("licorice", "Licorice", RepStyle::Licorice).with_appearance(Appearance {
                stick_radius: 0.30,
                // The stick is the whole representation, so it takes the atom colours.
                stick_color: None,
                ..Appearance::default()
            }),
            Look {
                line_width: Some(2.5),
                ..Look::new("stick", "Stick", RepStyle::Lines)
            }
            .with_appearance(Appearance { stick_color: None, ..Appearance::default() }),
        ]
    }

    /// The look to start with: the wikimolgen preset, the shape most Wikipedia figures use.
    pub fn default_small_molecule() -> Look {
        Look::new("publication", "Publication", RepStyle::BallStick)
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
    use crate::palette;

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
        // Dark carbon cannot come from CPK: gray35 disappears on `#0b0f14`.
        assert_eq!(dark.appearance.scheme, "dark");
        assert_eq!(palette::color(&dark.appearance.scheme, "C"), "#d7dde6");
    }

    #[test]
    fn the_default_appearance_is_the_wikimolgen_preset() {
        // Every number here is a wikimolgen `RenderConfig3D` default; a figure that
        // matches a wikimolgen render depends on them.
        let look = Look::default_small_molecule();
        let appearance = look.appearance;
        assert_eq!(appearance.scheme, "cpk");
        assert_eq!(appearance.background, "#ffffff");
        assert_eq!(appearance.stick_color.as_deref(), Some("#808080"));
        assert!((appearance.stick_radius - 0.20).abs() < 1e-6);
        assert!((appearance.sphere_scale - 0.30).abs() < 1e-6);
        assert!((appearance.ambient - 0.25).abs() < 1e-6);
        assert!((appearance.direct - 0.45).abs() < 1e-6);
        assert!((appearance.reflect - 0.45).abs() < 1e-6);
        assert!((appearance.specular - 1.0).abs() < 1e-6);
        assert!((appearance.shininess - 30.0).abs() < 1e-6);
        assert!(!appearance.ambient_occlusion, "wikimolgen renders with AO off");
        assert!(!appearance.silhouettes, "wikimolgen draws no outline");
        assert!(!appearance.depth_cue);
        assert!(appearance.element_colors.is_empty(), "the scheme carries the inks");
        assert_eq!(look.color_mode, ColorMode::Element);
    }

    #[test]
    fn the_scheme_stick_ink_matches_the_default() {
        // The default duplicates the CPK stick colour; this keeps the two in step.
        let infos = palette::scheme_infos();
        let cpk = infos.iter().find(|info| info.id == "cpk").expect("cpk scheme");
        assert_eq!(Appearance::default().stick_color.as_deref(), cpk.stick_color);
    }

    #[test]
    fn the_secondary_structure_inks_are_the_wikimolgen_ones() {
        // Blue helix and yellow sheet are what a wikimolgen protein figure shows.
        let appearance = Appearance::default();
        assert_eq!(appearance.helix_color, "#3399ff");
        assert_eq!(appearance.sheet_color, "#ffcc00");
        assert_eq!(appearance.loop_color, "#99aabb");
    }

    #[test]
    fn the_finish_options_match_the_wikimolgen_defaults() {
        // Fog start and the transparency mode are wikimolgen values.
        let appearance = Appearance::default();
        assert!((appearance.fog_start - 1.0).abs() < 1e-6);
        assert!(appearance.valence);
        assert!((appearance.stick_valence_scale - 1.0).abs() < 1e-6);
        assert!((appearance.ao_radius - 0.5).abs() < 1e-6);
        assert!((appearance.shadow_intensity - 0.5).abs() < 1e-6);
        assert_eq!(appearance.transparency_mode, 1);
        assert!(appearance.antialias);
    }

    #[test]
    fn looks_round_trip_through_json() {
        // The UI ships these as JSON; a serde rename would break it silently.
        let looks = Look::small_molecule_looks();
        let json = serde_json::to_string(&looks).expect("serialise looks");
        assert!(json.contains("\"ball_stick\""));
        assert!(json.contains("\"color_mode\":\"element\""));
        assert!(json.contains("\"appearance\":{"), "the appearance travels with the look");
        assert!(json.contains("\"scheme\":\"cpk\""));
        let back: Vec<Look> = serde_json::from_str(&json).expect("deserialise looks");
        assert_eq!(back.len(), looks.len());
        assert_eq!(back[0].style, RepStyle::BallStick);
        assert_eq!(back[2].appearance.background, "#0b0f14");
        assert!((back[0].appearance.stick_radius - 0.20).abs() < 1e-6);
        assert_eq!(back[0].appearance.stick_color.as_deref(), Some("#808080"));
    }

    #[test]
    fn the_uniform_colour_mode_round_trips() {
        // The adapter matches on this string; a serde rename would fall through to element.
        assert_eq!(serde_json::to_string(&ColorMode::Uniform).unwrap(), "\"uniform\"");
        assert_eq!(
            serde_json::from_str::<ColorMode>("\"uniform\"").unwrap(),
            ColorMode::Uniform
        );
        assert_eq!(serde_json::to_string(&ColorMode::SecStruct).unwrap(), "\"sec_struct\"");
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
        assert!((look.appearance.stick_radius - 0.20).abs() < 1e-6);
        assert_eq!(look.appearance.scheme, palette::DEFAULT_SCHEME);
    }

    #[test]
    fn an_old_look_with_the_retired_element_overrides_still_loads() {
        // The three finishes used to carry print inks in `element_colors`; a stored
        // preset from that build must keep working.
        let old = r##"{"id":"publication","label":"Publication","style":"ball_stick","color_mode":"element","material":null,"line_width":null,"appearance":{"background":"#ffffff","stick_radius":0.17,"element_colors":[{"element":"O","color":"#d42a1e"}]}}"##;
        let look: Look = serde_json::from_str(old).expect("legacy look must parse");
        assert_eq!(look.appearance.element_colors.len(), 1);
        assert_eq!(look.appearance.scheme, palette::DEFAULT_SCHEME);
        assert_eq!(look.appearance.stick_color.as_deref(), Some("#808080"));
    }
}

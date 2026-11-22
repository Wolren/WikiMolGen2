//! Browser bindings for WikiMolGen 2.
//!
//! Two jobs, both only meaningful on `wasm32`, and neither of them renders:
//!
//! 1. **Turn a renderer's PNG into a figure.** The viewer publishes whatever it drew at
//!    the surface size; a figure is that content, cropped to the molecule and given an
//!    even margin. The pixel work stays in [`wikimolgen2_core::image_ops`] so it is the same
//!    code the unit tests cover.
//! 2. **Generate Wikipedia markup.** Presets and templates are Rust so the page cannot
//!    drift from them.
//!
//! The 3D viewer itself is patinae's web build, vendored under `web/public/vendor/` and
//! driven from `web/src/renderer.ts`. That is a deliberate trade: patinae's web crate is
//! its own cargo workspace with internal path dependencies, so it cannot be consumed as a
//! git dependency, and the vendored build is the only reproducible option that does not
//! copy 200k lines into this repo. `docs/renderer.md` records the provenance and the
//! rebuild command.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen::prelude::*;

/// Install the panic hook so a Rust panic in the console is readable.
///
/// Runs automatically when the module is initialised; it is not called by name.
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// Crop a rendered PNG to its content and pad it with an even margin.
///
/// `margin` is a fraction of the molecule's longer side, so the same compound comes out
/// the same size whatever the viewport happened to be. The margin colour is passed in
/// because a figure on a dark background needs a matching border, and a transparent
/// figure needs alpha 0 rather than white. Returns PNG bytes.
#[wasm_bindgen(js_name = frameFigure)]
pub fn frame_figure(
    png: Vec<u8>,
    margin: f32,
    red: u8,
    green: u8,
    blue: u8,
    alpha: u8,
) -> Result<Vec<u8>, JsError> {
    let image = wikimolgen2_core::image_ops::decode_png(&png)
        .map_err(|error| JsError::new(&error.to_string()))?;
    let figure = wikimolgen2_core::image_ops::frame_figure_with(&image, margin, [red, green, blue, alpha]);
    wikimolgen2_core::image_ops::encode_png(&figure).map_err(|error| JsError::new(&error.to_string()))
}

/// Compose a figure at an exact width, with a margin, an optional gradient and a scale bar.
///
/// `spec_json` is `wikimolgen2_core::figure::FigureSpec`. The input is the raw render; the
/// output is the cropped, scaled and padded figure. Returns PNG bytes.
#[wasm_bindgen(js_name = composeFigure)]
pub fn compose_figure(png: Vec<u8>, spec_json: String) -> Result<Vec<u8>, JsError> {
    let spec: wikimolgen2_core::FigureSpec = serde_json::from_str(&spec_json)
        .map_err(|error| JsError::new(&format!("bad figure spec: {error}")))?;
    let image = wikimolgen2_core::image_ops::decode_png(&png)
        .map_err(|error| JsError::new(&error.to_string()))?;
    let figure = wikimolgen2_core::compose_figure(&image, &spec);
    wikimolgen2_core::image_ops::encode_png(&figure).map_err(|error| JsError::new(&error.to_string()))
}

/// Scale a PNG to the given size with a good filter.
///
/// Used to supersample: the renderer's browser build has FXAA but no MSAA, so a silhouette
/// is roughly one hard pixel. Rendering at 2× and scaling down here is what smooths it.
#[wasm_bindgen(js_name = resizePng)]
pub fn resize_png(png: Vec<u8>, width: u32, height: u32) -> Result<Vec<u8>, JsError> {
    let image = wikimolgen2_core::image_ops::decode_png(&png)
        .map_err(|error| JsError::new(&error.to_string()))?;
    let scaled = wikimolgen2_core::image_ops::resize(&image, width, height);
    wikimolgen2_core::image_ops::encode_png(&scaled).map_err(|error| JsError::new(&error.to_string()))
}

// --- Presets and Wikipedia markup ---------------------------------------------------
//
// Free functions rather than methods on a viewer handle: they need no renderer, so the
// page can build its preset buttons before (or without) a GPU context.

/// The built-in looks as JSON, for the UI's style picker.
#[wasm_bindgen(js_name = looksJson)]
pub fn looks_json() -> Result<String, JsError> {
    let looks = wikimolgen2_core::Look::small_molecule_looks();
    serde_json::to_string(&looks).map_err(|error| JsError::new(&error.to_string()))
}

/// The looks offered for a protein, as JSON. Cartoons colour by secondary structure.
#[wasm_bindgen(js_name = proteinLooksJson)]
pub fn protein_looks_json() -> Result<String, JsError> {
    let looks = wikimolgen2_core::Look::protein_looks();
    serde_json::to_string(&looks).map_err(|error| JsError::new(&error.to_string()))
}

/// Draw a V2000 mol block as a 2D skeletal SVG.
///
/// The drawing is vector, so the width only sets the nominal canvas. Heteroatoms are
/// always labelled; `labels` adds the carbons, and `monochrome` prints one ink colour.
#[wasm_bindgen(js_name = depictSvg)]
pub fn depict_svg(
    sdf: Vec<u8>,
    width: u32,
    margin: f32,
    labels: bool,
    monochrome: bool,
    name: String,
) -> Result<String, JsError> {
    let text = String::from_utf8(sdf)
        .map_err(|error| JsError::new(&format!("the 2D record is not UTF-8: {error}")))?;
    wikimolgen2_core::depiction_svg(
        &text,
        &name,
        wikimolgen2_core::DepictionOptions { width, margin, labels, monochrome },
    )
    .map_err(|error| JsError::new(&error.to_string()))
}

/// The default colour of an element, `#rrggbb`, for a UI swatch.
#[wasm_bindgen(js_name = elementColor)]
pub fn element_color(symbol: String) -> String {
    wikimolgen2_core::depict::element_color(&symbol).to_string()
}

/// The colour schemes as JSON, in the order the colour panel lists them.
///
/// Each entry carries the id the page sends back, a label, a one-sentence description and
/// the stick ink the scheme expects (`null` for sticks that follow the atoms).
#[wasm_bindgen(js_name = colorSchemesJson)]
pub fn color_schemes_json() -> Result<String, JsError> {
    let schemes = wikimolgen2_core::palette::scheme_infos();
    serde_json::to_string(&schemes).map_err(|error| JsError::new(&error.to_string()))
}

/// One element's ink in a scheme, `#rrggbb`.
///
/// The page asks per element so it can label the chips with the colour a figure will use.
/// An unknown scheme id resolves as the default scheme.
#[wasm_bindgen(js_name = schemeColor)]
pub fn scheme_color(scheme: String, symbol: String) -> String {
    wikimolgen2_core::palette::color(&scheme, &symbol).to_string()
}

/// The licence a new upload should offer for a structure kind.
///
/// The rule lives in Rust so the Commons block and the upload URL cannot disagree.
#[wasm_bindgen(js_name = defaultLicense)]
pub fn default_license(kind: String) -> Result<String, JsError> {
    let license = wikimolgen2_core::License::default_for(structure_kind(&kind)?);
    Ok(license.id().to_string())
}

/// Parse a structure kind as the page spells it: `"two_d"`, `"three_d"` or `"protein"`.
fn structure_kind(kind: &str) -> Result<wikimolgen2_core::StructureKind, JsError> {
    serde_json::from_str(&format!("\"{kind}\""))
        .map_err(|error| JsError::new(&format!("unknown structure kind {kind:?}: {error}")))
}

/// `{{Infobox drug}}` for a compound (JSON) and an image file name.
#[wasm_bindgen(js_name = drugbox)]
pub fn drugbox_json(compound_json: String, image: String) -> Result<String, JsError> {
    let compound: wikimolgen2_core::Compound =
        serde_json::from_str(&compound_json).map_err(|error| JsError::new(&error.to_string()))?;
    Ok(wikimolgen2_core::drugbox(&compound, &image))
}

/// `{{Chembox}}` for a compound (JSON) and an image file name.
#[wasm_bindgen(js_name = chembox)]
pub fn chembox_json(compound_json: String, image: String) -> Result<String, JsError> {
    let compound: wikimolgen2_core::Compound =
        serde_json::from_str(&compound_json).map_err(|error| JsError::new(&error.to_string()))?;
    Ok(wikimolgen2_core::chembox(&compound, &image))
}

/// The Commons file name for a compound and a kind (`"two_d"`, `"three_d"`, `"protein"`).
#[wasm_bindgen(js_name = commonsFileName)]
pub fn commons_file_name_json(compound_json: String, kind: String) -> Result<String, JsError> {
    let compound: wikimolgen2_core::Compound =
        serde_json::from_str(&compound_json).map_err(|error| JsError::new(&error.to_string()))?;
    Ok(wikimolgen2_core::commons_file_name(&compound, structure_kind(&kind)?))
}

/// The name a figure is saved and uploaded as, taking an optional typed name.
///
/// `typed` is the file-name field: an empty or unusable string falls back to the generated
/// name, and the extension always follows the kind, so a 2D figure ends in `.svg`.
#[wasm_bindgen(js_name = figureFileName)]
pub fn figure_file_name_json(
    compound_json: String,
    kind: String,
    typed: String,
) -> Result<String, JsError> {
    let compound: wikimolgen2_core::Compound =
        serde_json::from_str(&compound_json).map_err(|error| JsError::new(&error.to_string()))?;
    Ok(wikimolgen2_core::figure_file_name(&compound, structure_kind(&kind)?, &typed))
}

/// The Commons `{{Information}}` block.
#[wasm_bindgen(js_name = commonsInformation)]
pub fn commons_information_json(
    compound_json: String,
    kind: String,
    author: String,
    license: String,
    iso_date: String,
) -> Result<String, JsError> {
    let compound: wikimolgen2_core::Compound =
        serde_json::from_str(&compound_json).map_err(|error| JsError::new(&error.to_string()))?;
    let license = serde_json::from_str(&format!("\"{license}\""))
        .map_err(|error| JsError::new(&format!("unknown license {license:?}: {error}")))?;
    Ok(wikimolgen2_core::commons_information(
        &compound,
        structure_kind(&kind)?,
        &author,
        license,
        &iso_date,
    ))
}

/// The pre-filled Commons upload URL for a file name, description and licence.
#[wasm_bindgen(js_name = commonsUploadUrl)]
pub fn commons_upload_url_json(file_name: String, description: String, license: String) -> Result<String, JsError> {
    let license = serde_json::from_str(&format!("\"{license}\""))
        .map_err(|error| JsError::new(&format!("unknown license {license:?}: {error}")))?;
    Ok(wikimolgen2_core::commons_upload_url(&file_name, &description, license))
}

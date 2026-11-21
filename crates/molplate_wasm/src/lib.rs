//! Browser bindings for molplate.
//!
//! Two jobs, both only meaningful on `wasm32`, and neither of them renders:
//!
//! 1. **Turn a renderer's PNG into a figure.** The viewer publishes whatever it drew at
//!    the surface size; a figure is that content, cropped to the molecule and given an
//!    even margin. The pixel work stays in [`molplate_core::image_ops`] so it is the same
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
    let image = molplate_core::image_ops::decode_png(&png)
        .map_err(|error| JsError::new(&error.to_string()))?;
    let figure = molplate_core::image_ops::frame_figure_with(&image, margin, [red, green, blue, alpha]);
    molplate_core::image_ops::encode_png(&figure).map_err(|error| JsError::new(&error.to_string()))
}

/// Scale a PNG to the given size with a good filter.
///
/// Used to supersample: the renderer's browser build has FXAA but no MSAA, so a silhouette
/// is roughly one hard pixel. Rendering at 2× and scaling down here is what smooths it.
#[wasm_bindgen(js_name = resizePng)]
pub fn resize_png(png: Vec<u8>, width: u32, height: u32) -> Result<Vec<u8>, JsError> {
    let image = molplate_core::image_ops::decode_png(&png)
        .map_err(|error| JsError::new(&error.to_string()))?;
    let scaled = molplate_core::image_ops::resize(&image, width, height);
    molplate_core::image_ops::encode_png(&scaled).map_err(|error| JsError::new(&error.to_string()))
}

// --- Presets and Wikipedia markup ---------------------------------------------------
//
// Free functions rather than methods on a viewer handle: they need no renderer, so the
// page can build its preset buttons before (or without) a GPU context.

/// The built-in looks as JSON, for the UI's style picker.
#[wasm_bindgen(js_name = looksJson)]
pub fn looks_json() -> Result<String, JsError> {
    let looks = molplate_core::Look::small_molecule_looks();
    serde_json::to_string(&looks).map_err(|error| JsError::new(&error.to_string()))
}

/// The looks offered for a protein, as JSON. Cartoons colour by secondary structure.
#[wasm_bindgen(js_name = proteinLooksJson)]
pub fn protein_looks_json() -> Result<String, JsError> {
    let looks = molplate_core::Look::protein_looks();
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
    molplate_core::depiction_svg(
        &text,
        &name,
        molplate_core::DepictionOptions { width, margin, labels, monochrome },
    )
    .map_err(|error| JsError::new(&error.to_string()))
}

/// The default colour of an element, `#rrggbb`, for a UI swatch.
#[wasm_bindgen(js_name = elementColor)]
pub fn element_color(symbol: String) -> String {
    molplate_core::depict::element_color(&symbol).to_string()
}

/// The licence a new upload should offer for a structure kind.
///
/// The rule lives in Rust so the Commons block and the upload URL cannot disagree.
#[wasm_bindgen(js_name = defaultLicense)]
pub fn default_license(kind: String) -> Result<String, JsError> {
    let kind: molplate_core::StructureKind = serde_json::from_str(&format!("\"{kind}\""))
        .map_err(|error| JsError::new(&format!("unknown structure kind {kind:?}: {error}")))?;
    let license = molplate_core::License::default_for(kind);
    Ok(license.id().to_string())
}

/// `{{Infobox drug}}` for a compound (JSON) and an image file name.
#[wasm_bindgen(js_name = drugbox)]
pub fn drugbox_json(compound_json: String, image: String) -> Result<String, JsError> {
    let compound: molplate_core::Compound =
        serde_json::from_str(&compound_json).map_err(|error| JsError::new(&error.to_string()))?;
    Ok(molplate_core::drugbox(&compound, &image))
}

/// `{{Chembox}}` for a compound (JSON) and an image file name.
#[wasm_bindgen(js_name = chembox)]
pub fn chembox_json(compound_json: String, image: String) -> Result<String, JsError> {
    let compound: molplate_core::Compound =
        serde_json::from_str(&compound_json).map_err(|error| JsError::new(&error.to_string()))?;
    Ok(molplate_core::chembox(&compound, &image))
}

/// The Commons file name for a compound and a kind (`"two_d"`, `"three_d"`, `"protein"`).
#[wasm_bindgen(js_name = commonsFileName)]
pub fn commons_file_name_json(compound_json: String, kind: String) -> Result<String, JsError> {
    let compound: molplate_core::Compound =
        serde_json::from_str(&compound_json).map_err(|error| JsError::new(&error.to_string()))?;
    let kind = serde_json::from_str(&format!("\"{kind}\""))
        .map_err(|error| JsError::new(&format!("unknown structure kind {kind:?}: {error}")))?;
    Ok(molplate_core::commons_file_name(&compound, kind))
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
    let compound: molplate_core::Compound =
        serde_json::from_str(&compound_json).map_err(|error| JsError::new(&error.to_string()))?;
    let kind = serde_json::from_str(&format!("\"{kind}\""))
        .map_err(|error| JsError::new(&format!("unknown structure kind {kind:?}: {error}")))?;
    let license = serde_json::from_str(&format!("\"{license}\""))
        .map_err(|error| JsError::new(&format!("unknown license {license:?}: {error}")))?;
    Ok(molplate_core::commons_information(
        &compound, kind, &author, license, &iso_date,
    ))
}

/// The pre-filled Commons upload URL for a file name, description and licence.
#[wasm_bindgen(js_name = commonsUploadUrl)]
pub fn commons_upload_url_json(file_name: String, description: String, license: String) -> Result<String, JsError> {
    let license = serde_json::from_str(&format!("\"{license}\""))
        .map_err(|error| JsError::new(&format!("unknown license {license:?}: {error}")))?;
    Ok(molplate_core::commons_upload_url(&file_name, &description, license))
}

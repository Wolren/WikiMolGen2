//! molplate_core: the parts of the app that are neither the GPU viewer nor the DOM:
//! render presets, image post-processing and the Wikipedia markup.
//!
//! Everything here is target-independent on purpose. It compiles native, so the
//! behaviour that matters for output quality (cropping, margins, PNG encoding, wikitext
//! fields) can be unit-tested without a browser or a GPU; `molplate_wasm` is the only
//! crate that binds to JavaScript.

pub mod depict;
pub mod image_ops;
pub mod style;
pub mod wikitext;

pub use depict::{depiction_svg, DepictionError, DepictionOptions};
pub use style::{Appearance, ColorMode, ElementColor, Look, RepStyle};
pub use wikitext::{
    chembox, commons_file_name, commons_information, commons_upload_url, drugbox, Compound,
    License, StructureKind,
};

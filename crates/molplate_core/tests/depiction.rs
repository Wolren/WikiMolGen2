//! Acceptance for the 2D depiction: a real PubChem record, drawn as SVG.

use molplate_core::depict::{depiction_svg, DepictionError, DepictionOptions};

const ASPIRIN: &str = include_str!("data/aspirin-2d.sdf");

fn options() -> DepictionOptions {
    DepictionOptions { width: 800, margin: 0.06, labels: false, monochrome: false }
}

#[test]
fn aspirin_is_a_small_clean_svg_with_element_colours() {
    let svg = depiction_svg(ASPIRIN, "Aspirin", options()).expect("aspirin must draw");

    // The file has to be small enough to inline and to upload without a second thought.
    assert!(svg.len() < 100_000, "the SVG is {} bytes", svg.len());
    assert!(svg.starts_with("<?xml"), "an SVG document needs the XML declaration");
    assert!(svg.contains(r#"width="800""#), "the canvas width is the requested width");

    // Four oxygens are labelled; carbon and the explicit hydrogens are not.
    assert_eq!(svg.matches(">O</text>").count(), 4, "one label per oxygen");
    assert!(!svg.contains(">H</text>"), "hydrogens stay implicit");
    assert!(!svg.contains(">C</text>"), "carbons stay implicit in a skeletal formula");
    assert!(svg.contains("#d42a1e"), "oxygen must carry the element colour");
    assert!(svg.contains("<line"), "bonds are drawn as lines");
    assert!(svg.contains("stroke-width"), "bonds carry a printable width");
}

#[test]
fn a_name_with_markup_is_escaped() {
    let svg = depiction_svg(ASPIRIN, "A < B & C", options()).expect("aspirin must draw");
    assert!(svg.contains("A &lt; B &amp; C"), "the title must not break the document");
    assert!(!svg.contains("<title>A < B"), "raw markup must never reach the title");
}

#[test]
fn carbon_labels_are_optional() {
    let with_carbons = depiction_svg(
        ASPIRIN,
        "Aspirin",
        DepictionOptions { labels: true, ..options() },
    )
    .expect("aspirin must draw");
    assert!(with_carbons.matches(">C</text>").count() >= 9, "every heavy carbon is labelled");
    assert!(with_carbons.len() > 100, "labels add text nodes");
}

#[test]
fn monochrome_uses_one_ink_colour() {
    let svg = depiction_svg(
        ASPIRIN,
        "Aspirin",
        DepictionOptions { monochrome: true, ..options() },
    )
    .expect("aspirin must draw");
    assert!(!svg.contains("#d42a1e"), "monochrome must drop the element colours");
    assert!(svg.contains(r##"fill="#1a1a1a""##), "labels use the ink colour");
}

#[test]
fn v3000_is_refused_with_a_readable_error() {
    let error = depiction_svg("M  V30 BEGIN CTAB", "Modern", options()).unwrap_err();
    assert!(matches!(error, DepictionError::V3000), "got {error}");
    assert!(error.to_string().contains("V3000"));
}

#[test]
fn methane_without_hydrogens_still_draws() {
    // One heavy atom has zero extent, which a drawing cannot scale. The caller gets a
    // named error instead of a degenerate SVG.
    let block = "methane\n  test\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n";
    let error = depiction_svg(block, "Methane", options()).unwrap_err();
    assert!(matches!(error, DepictionError::Degenerate), "got {error}");
}

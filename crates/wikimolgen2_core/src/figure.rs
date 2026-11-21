//! Turn a render into a publication figure at an exact width.
//!
//! A render is the whole viewport with the molecule somewhere inside it. A figure is the
//! molecule, a known margin and an exact print width. [`compose_figure`] trims, scales to
//! the inner width, and pads the margin, so the later image operations cannot change the
//! headline number.
//!
//! The scale bar is drawn here because the camera is only readable through `get_view`.
//! The caller passes Ångström per render pixel; the compose step rescales it with the
//! content.

use image::{Rgba, RgbaImage};

use crate::image_ops::{resize, trim_to_content};

/// What the export button asks for.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(default)]
pub struct FigureSpec {
    /// Final image width in pixels. The height follows the content.
    pub width: u32,
    /// Margin as a fraction of the final width, e.g. 0.06 for six percent.
    pub margin: f32,
    /// Margin and background colour. Alpha 0 makes a transparent figure.
    pub background: [u8; 4],
    /// Export-only vertical gradient from the top stop to the bottom stop.
    pub gradient: Option<[[u8; 3]; 2]>,
    pub scale_bar: Option<ScaleBarSpec>,
}

impl Default for FigureSpec {
    fn default() -> Self {
        Self {
            width: 1600,
            margin: 0.06,
            background: [255, 255, 255, 255],
            gradient: None,
            scale_bar: None,
        }
    }
}

/// Ångström per pixel in the rendered image, before the compose step rescales it.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
pub struct ScaleBarSpec {
    pub angstrom_per_pixel: f32,
}

/// Compose a figure at the exact requested width.
///
/// The content is scaled to `width - 2 * margin_px`, so the horizontal margin is exact
/// and no atom can leave the canvas. The resulting height is content-driven.
pub fn compose_figure(rendered: &RgbaImage, spec: &FigureSpec) -> RgbaImage {
    let content = trim_to_content(rendered, 6);
    let width = spec.width.clamp(200, 8000);
    let margin = (width as f32 * spec.margin.clamp(0.02, 0.2)).round() as u32;
    let inner = width.saturating_sub(2 * margin).max(1);

    let scale = inner as f32 / content.width().max(1) as f32;
    let content_height = ((content.height() as f32 * scale).round() as u32).max(1);
    let height = content_height + 2 * margin;

    let mut out = background(width, height, spec);
    let scaled = resize(&content, inner, content_height);
    image::imageops::overlay(&mut out, &scaled, i64::from(margin), i64::from(margin));

    if let Some(bar) = spec.scale_bar {
        // One rendered pixel becomes `inner / content.width()` final pixels.
        let correction = content.width() as f32 / inner as f32;
        draw_scale_bar(&mut out, spec, margin, bar.angstrom_per_pixel * correction);
    }
    out
}

/// Fill the canvas with the solid colour or the vertical gradient.
fn background(width: u32, height: u32, spec: &FigureSpec) -> RgbaImage {
    let mut out = RgbaImage::from_pixel(width, height, Rgba(spec.background));
    // A transparent figure has no gradient: the caller wants alpha 0 behind the content.
    if spec.background[3] != 255 {
        return out;
    }
    let Some([top, bottom]) = spec.gradient else {
        return out;
    };
    for y in 0..height {
        let t = if height > 1 { y as f32 / (height - 1) as f32 } else { 0.0 };
        let row = Rgba([
            lerp_channel(top[0], bottom[0], t),
            lerp_channel(top[1], bottom[1], t),
            lerp_channel(top[2], bottom[2], t),
            255,
        ]);
        for x in 0..width {
            out.put_pixel(x, y, row);
        }
    }
    out
}

fn lerp_channel(a: u8, b: u8, t: f32) -> u8 {
    (f32::from(a) + (f32::from(b) - f32::from(a)) * t.clamp(0.0, 1.0)).round() as u8
}

// --- Scale bar ----------------------------------------------------------------------

const NICE_LENGTHS: [f32; 12] =
    [0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0, 500.0];

/// Draw a length bar in the bottom margin band with a label above it.
fn draw_scale_bar(img: &mut RgbaImage, spec: &FigureSpec, margin: u32, angstrom_per_pixel: f32) {
    if !angstrom_per_pixel.is_finite() || angstrom_per_pixel <= 0.0 {
        return;
    }
    let width = img.width();
    let height = img.height();
    if margin < 18 || height < margin + 8 {
        return;
    }

    let target = width as f32 * 0.20;
    let (value, bar_px) = pick_length(angstrom_per_pixel, target);
    if bar_px < 8 || bar_px > width.saturating_sub(2 * margin) {
        return;
    }

    let colour = ink_colour(spec, height.saturating_sub(margin / 2), height);
    let thickness = (width / 600).max(2);
    let inset = (width as f32 * 0.012).round() as u32;
    let x = (margin + inset).min(width.saturating_sub(bar_px + 1));
    let bar_y = height - margin / 2;
    let scale = (width as f32 / 800.0).round().max(1.0) as u32;
    let label = format_length(value);
    let text_height = 7 * scale + if label.contains('Å') { 3 * scale } else { 0 };
    let label_top = bar_y.saturating_sub(thickness + 8 + text_height);

    fill_rect(img, x, bar_y, bar_px, thickness, colour);
    draw_text(img, x, label_top, &label, scale, colour);
}

/// Largest nice length that leaves a bar near the target width.
fn pick_length(angstrom_per_pixel: f32, target_px: f32) -> (f32, u32) {
    let mut best = NICE_LENGTHS[0];
    let mut found = false;
    for value in NICE_LENGTHS {
        let px = value / angstrom_per_pixel;
        if px <= target_px * 1.2 {
            best = value;
            found = true;
        }
    }
    if !found {
        // A very large Å per pixel: the shortest label is the only useful one.
        best = NICE_LENGTHS[0];
    }
    (best, (best / angstrom_per_pixel).round() as u32)
}

fn format_length(value: f32) -> String {
    if value >= 10.0 || (value - value.round()).abs() < 0.01 {
        format!("{} Å", value.round() as i32)
    } else {
        format!("{value:.1} Å")
    }
}

/// Dark ink on a light background, light ink on a dark one; transparent counts as light.
fn ink_colour(spec: &FigureSpec, y: u32, height: u32) -> Rgba<u8> {
    let rgb = if spec.background[3] == 0 {
        [255, 255, 255]
    } else if let Some([top, bottom]) = spec.gradient {
        let t = if height > 1 { y as f32 / (height - 1) as f32 } else { 0.0 };
        [
            lerp_channel(top[0], bottom[0], t),
            lerp_channel(top[1], bottom[1], t),
            lerp_channel(top[2], bottom[2], t),
        ]
    } else {
        [spec.background[0], spec.background[1], spec.background[2]]
    };
    let luminance = 0.2126 * f32::from(rgb[0]) + 0.7152 * f32::from(rgb[1]) + 0.0722 * f32::from(rgb[2]);
    if luminance > 140.0 {
        Rgba([26, 26, 26, 255])
    } else {
        Rgba([242, 242, 242, 255])
    }
}

fn fill_rect(img: &mut RgbaImage, x: u32, y: u32, width: u32, height: u32, colour: Rgba<u8>) {
    let (w, h) = img.dimensions();
    for py in y..y.saturating_add(height).min(h) {
        for px in x..x.saturating_add(width).min(w) {
            img.put_pixel(px, py, colour);
        }
    }
}

// --- Bitmap label font --------------------------------------------------------------
//
// Five by seven source rows. The only text a figure needs here is a length and its unit,
// so the table holds digits, a point, a space and A with a ring for Ångström.

const FONT_A: [u8; 7] = [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001];

fn glyph(ch: char) -> Option<[u8; 7]> {
    Some(match ch {
        '0' => [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
        '1' => [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
        '2' => [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
        '3' => [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
        '4' => [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
        '5' => [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
        '6' => [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
        '7' => [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
        '8' => [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
        '9' => [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
        '.' => [0, 0, 0, 0, 0, 0b01100, 0b01100],
        ' ' => [0; 7],
        'A' | 'Å' => FONT_A,
        _ => return None,
    })
}

fn draw_text(img: &mut RgbaImage, x: u32, y: u32, text: &str, scale: u32, colour: Rgba<u8>) {
    let mut cursor = x;
    for ch in text.chars() {
        let Some(rows) = glyph(ch) else { continue };
        for (row, bits) in rows.iter().enumerate() {
            for column in 0..5 {
                if bits & (1 << (4 - column)) == 0 {
                    continue;
                }
                fill_rect(
                    img,
                    cursor + column * scale,
                    y + row as u32 * scale,
                    scale,
                    scale,
                    colour,
                );
            }
        }
        if ch == 'Å' {
            draw_ring(img, cursor + 2 * scale, y.saturating_sub(3 * scale), scale, colour);
        }
        cursor += 6 * scale;
    }
}

/// A small circle above the A, which turns it into Å without a second font row.
fn draw_ring(img: &mut RgbaImage, x: u32, y: u32, scale: u32, colour: Rgba<u8>) {
    const POINTS: [(i32, i32); 8] =
        [(0, -2), (1, -1), (2, 0), (1, 1), (0, 2), (-1, 1), (-2, 0), (-1, -1)];
    for (dx, dy) in POINTS {
        let px = x as i32 + dx * scale as i32;
        let py = y as i32 + dy * scale as i32;
        if px < 0 || py < 0 {
            continue;
        }
        fill_rect(img, px as u32, py as u32, scale, scale, colour);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn capture(background: [u8; 4], block: (u32, u32, u32, u32)) -> RgbaImage {
        let mut img = RgbaImage::from_pixel(600, 500, Rgba(background));
        for y in block.1..block.1 + block.3 {
            for x in block.0..block.0 + block.2 {
                img.put_pixel(x, y, Rgba([200, 30, 30, 255]));
            }
        }
        img
    }

    #[test]
    fn composes_at_the_exact_width_with_an_exact_margin() {
        // A 200x150 molecule inside a 600x500 viewport.
        let img = capture([255, 255, 255, 255], (200, 175, 200, 150));
        let figure = compose_figure(&img, &FigureSpec { width: 1600, margin: 0.06, ..FigureSpec::default() });
        assert_eq!(figure.width(), 1600, "the headline width must be exact");
        // 200 px content into 1408 px inner, 100 px margin on each side.
        let margin = 96u32;
        assert_eq!(figure.get_pixel(0, 0), &Rgba([255, 255, 255, 255]));
        assert_eq!(figure.get_pixel(margin - 1, margin - 1), &Rgba([255, 255, 255, 255]));
        assert_eq!(figure.get_pixel(margin, margin), &Rgba([200, 30, 30, 255]));
        assert_eq!(
            figure.get_pixel(figure.width() - margin - 1, margin + 20),
            &Rgba([200, 30, 30, 255])
        );
        assert_eq!(
            figure.get_pixel(figure.width() - margin, margin + 20),
            &Rgba([255, 255, 255, 255])
        );
    }

    #[test]
    fn the_measured_margin_is_between_five_and_seven_percent() {
        let img = capture([255, 255, 255, 255], (100, 100, 300, 200));
        let figure = compose_figure(&img, &FigureSpec { width: 1600, margin: 0.06, ..FigureSpec::default() });
        // Find the first column that is not background.
        let mut first = figure.width();
        for x in 0..figure.width() {
            let pixel = figure.get_pixel(x, figure.height() / 2);
            if pixel.0 != [255, 255, 255, 255] {
                first = x;
                break;
            }
        }
        let percent = f64::from(first) / f64::from(figure.width()) * 100.0;
        assert!((5.0..=7.0).contains(&percent), "margin is {percent:.2}%");
        assert_eq!(first, 96);
    }

    #[test]
    fn a_transparent_figure_keeps_its_alpha() {
        let img = capture([0, 0, 0, 0], (200, 175, 100, 100));
        let figure = compose_figure(
            &img,
            &FigureSpec { width: 1200, margin: 0.05, background: [0, 0, 0, 0], ..FigureSpec::default() },
        );
        assert_eq!(figure.get_pixel(0, 0).0[3], 0);
        let centre = figure.get_pixel(figure.width() / 2, figure.height() / 2);
        assert_eq!(centre.0[3], 255, "the molecule stays opaque");
    }

    #[test]
    fn a_gradient_fills_the_margin_band() {
        let img = capture([255, 255, 255, 255], (200, 175, 100, 100));
        let figure = compose_figure(
            &img,
            &FigureSpec {
                width: 1200,
                margin: 0.06,
                gradient: Some([[255, 255, 255], [0, 0, 0]]),
                ..FigureSpec::default()
            },
        );
        let top = figure.get_pixel(figure.width() - 2, 0);
        let bottom = figure.get_pixel(figure.width() - 2, figure.height() - 1);
        assert!(top.0[0] > bottom.0[0], "the gradient runs light to dark");
        assert_eq!(top.0[3], 255);
    }

    #[test]
    fn the_scale_bar_puts_ink_in_the_bottom_margin() {
        let img = capture([255, 255, 255, 255], (200, 175, 100, 100));
        let figure = compose_figure(
            &img,
            &FigureSpec {
                width: 1600,
                margin: 0.06,
                scale_bar: Some(ScaleBarSpec { angstrom_per_pixel: 0.02 }),
                ..FigureSpec::default()
            },
        );
        let margin = 96;
        let mut dark = 0;
        for y in figure.height() - margin..figure.height() {
            for x in 0..figure.width() {
                if figure.get_pixel(x, y).0[0] < 80 {
                    dark += 1;
                }
            }
        }
        assert!(dark > 50, "the scale bar and its label must be visible, found {dark} dark pixels");
    }

    #[test]
    fn the_bar_length_follows_the_scale() {
        // 0.02 Å/px: a 2 Å bar is 100 px, a 5 Å bar is 250 px. At 1600 the target is 288.
        let (value, px) = pick_length(0.02, 1600.0 * 0.18);
        assert_eq!(value, 5.0);
        assert_eq!(px, 250);
        // 0.5 Å/px: 100 Å is 200 px, 200 Å is 400 px, above the target.
        let (value, px) = pick_length(0.5, 1600.0 * 0.18);
        assert_eq!(value, 100.0);
        assert_eq!(px, 200);
    }

    #[test]
    fn labels_render_digits_and_a_ring() {
        let mut img = RgbaImage::from_pixel(120, 40, Rgba([255, 255, 255, 255]));
        draw_text(&mut img, 4, 8, "2 Å", 3, Rgba([0, 0, 0, 255]));
        let ink = img.pixels().filter(|pixel| pixel.0[0] < 40).count();
        assert!(ink > 30, "digits and the ring must draw ink, found {ink}");
    }

    #[test]
    fn a_tiny_capture_still_composes() {
        let img = RgbaImage::from_pixel(10, 10, Rgba([255, 255, 255, 255]));
        let figure = compose_figure(&img, &FigureSpec { width: 800, margin: 0.06, ..FigureSpec::default() });
        assert_eq!(figure.width(), 800);
        assert!(figure.height() >= 2);
    }
}

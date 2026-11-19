//! Post-processing between "the GPU drew a frame" and "the user has a file".
//!
//! A capture comes back at whatever size the viewport happened to have, with the
//! molecule somewhere inside it. Figures need the opposite: a tight crop with a
//! predictable margin, at a known aspect ratio. Doing that here rather than in
//! TypeScript keeps it unit-testable and keeps the pixel work in Rust.

use image::{ExtendedColorType, ImageEncoder, Rgba, RgbaImage};

#[derive(Debug, thiserror::Error)]
pub enum ImageError {
    #[error("PNG encode failed: {0}")]
    Encode(#[from] image::ImageError),
}

/// Crop away the uniform border, using the top-left pixel as the background colour.
///
/// A capture of an empty scene trims to a single pixel rather than to nothing, so the
/// caller can still report a size instead of dividing by zero downstream.
pub fn trim_to_content(img: &RgbaImage, tolerance: u8) -> RgbaImage {
    let background = *img.get_pixel(0, 0);
    let (mut left, mut top) = (u32::MAX, u32::MAX);
    let (mut right, mut bottom) = (0u32, 0u32);

    for (x, y, pixel) in img.enumerate_pixels() {
        if !similar(pixel, &background, tolerance) {
            left = left.min(x);
            top = top.min(y);
            right = right.max(x);
            bottom = bottom.max(y);
        }
    }

    if left == u32::MAX {
        // Nothing distinct from the background: keep a 1×1 corner as a benign result.
        return RgbaImage::from_pixel(1, 1, background);
    }
    crop(img, left, top, right - left + 1, bottom - top + 1)
}

/// Copy a sub-rectangle out. Clamped to the image, so callers can pass a margin round a
/// crop without bounds arithmetic.
pub fn crop(img: &RgbaImage, x: u32, y: u32, width: u32, height: u32) -> RgbaImage {
    let x = x.min(img.width());
    let y = y.min(img.height());
    let width = width.min(img.width() - x).max(1);
    let height = height.min(img.height() - y).max(1);
    image::imageops::crop_imm(img, x, y, width, height).to_image()
}

/// Grow the image by `margin` pixels on every side, filling with `fill`.
pub fn pad(img: &RgbaImage, margin: u32, fill: [u8; 4]) -> RgbaImage {
    let (w, h) = img.dimensions();
    let mut out = RgbaImage::from_pixel(w + 2 * margin, h + 2 * margin, Rgba::from(fill));
    image::imageops::overlay(&mut out, img, i64::from(margin), i64::from(margin));
    out
}

/// Centre the image on a canvas of the given aspect ratio (`aspect_width / aspect_height`),
/// filling the new area with `fill`.
///
/// Wikipedia infobox images are usually 1:1 or 4:3; a viewport capture is whatever the
/// browser window is, so the frames are normalised here instead of asking the user to
/// resize their window.
pub fn pad_to_aspect(img: &RgbaImage, aspect_width: u32, aspect_height: u32, fill: [u8; 4]) -> RgbaImage {
    let (w, h) = img.dimensions();
    let target = aspect_width as f64 / aspect_height as f64;
    let current = f64::from(w) / f64::from(h);

    if current < target {
        // Too tall: widen.
        let new_w = (f64::from(h) * target).round() as u32;
        centred_canvas(img, new_w.max(w), h, fill)
    } else if current > target {
        // Too wide: heighten.
        let new_h = (f64::from(w) / target).round() as u32;
        centred_canvas(img, w, new_h.max(h), fill)
    } else {
        img.clone()
    }
}

fn centred_canvas(img: &RgbaImage, width: u32, height: u32, fill: [u8; 4]) -> RgbaImage {
    let mut out = RgbaImage::from_pixel(width, height, Rgba::from(fill));
    let x = i64::from((width - img.width()) / 2);
    let y = i64::from((height - img.height()) / 2);
    image::imageops::overlay(&mut out, img, x, y);
    out
}

/// Turn a rendered viewport into a figure.
///
/// A render is the whole viewport: a flat background with the molecule somewhere inside
/// it. A figure is the opposite — the molecule, and an even margin, at a size that does
/// not depend on the window. One trim and one pad does that:
///
/// 1. trim the uniform background, which leaves exactly the molecule;
/// 2. add a margin, as a fraction of the molecule's longer side.
///
/// This used to trim twice, because the previous renderer painted its own grey frame
/// around the scene, so a capture had two background layers. patinae draws no chrome, and
/// a second trim on a single-background image crops to whatever the molecule's corner
/// pixel happens to be — a bug the transparent-capture test caught.
pub fn frame_figure(img: &RgbaImage, margin: f32) -> RgbaImage {
    frame_figure_with(img, margin, [255, 255, 255, 255])
}

/// [`frame_figure`] with a caller-chosen margin colour.
///
/// The colour matters twice over: a figure drawn on a dark background should not gain a
/// white border, and a transparent figure must be padded with alpha 0 rather than white,
/// or the export stops being transparent the moment it is cropped.
pub fn frame_figure_with(img: &RgbaImage, margin: f32, fill: [u8; 4]) -> RgbaImage {
    let content = trim_to_content(img, 6);

    let longer = content.width().max(content.height()) as f32;
    let padding = (longer * margin.clamp(0.0, 0.25)).round() as u32;
    pad(&content, padding.max(1), fill)
}

/// Scale an image down with a good resampling filter.
///
/// The renderer antialiases with FXAA only — there is no MSAA and no built-in supersampling
/// in its web build — so a silhouette is roughly one hard pixel. Rendering larger and
/// scaling down here is what actually smooths it: at 2× the edge gradient is about three
/// times wider, and going beyond 2× adds nothing.
///
/// Alpha is premultiplied across the resize and undone afterwards. Resizing straight
/// alpha would let the transparent pixels' colour (black) bleed into every edge, which
/// shows up as a dark fringe on a transparent figure.
pub fn resize(img: &RgbaImage, width: u32, height: u32) -> RgbaImage {
    let mut premultiplied = img.clone();
    for pixel in premultiplied.pixels_mut() {
        let alpha = u32::from(pixel.0[3]);
        for channel in 0..3 {
            pixel.0[channel] = ((u32::from(pixel.0[channel]) * alpha) / 255) as u8;
        }
    }

    let mut out = image::imageops::resize(
        &premultiplied,
        width.max(1),
        height.max(1),
        // Triangle, not Lanczos: at a 2:1 downscale it is close to an area average and,
        // unlike the windowed-sinc filters, it has no negative lobes — so a hard silhouette
        // does not gain a bright halo ring on the background side.
        image::imageops::FilterType::Triangle,
    );

    for pixel in out.pixels_mut() {
        let alpha = u32::from(pixel.0[3]);
        if alpha == 0 {
            continue;
        }
        for channel in 0..3 {
            pixel.0[channel] = (u32::from(pixel.0[channel]) * 255 / alpha).min(255) as u8;
        }
    }
    out
}

pub fn encode_png(img: &RgbaImage) -> Result<Vec<u8>, ImageError> {
    let mut out = std::io::Cursor::new(Vec::new());
    image::codecs::png::PngEncoder::new(&mut out).write_image(
        img.as_raw(),
        img.width(),
        img.height(),
        ExtendedColorType::Rgba8,
    )?;
    Ok(out.into_inner())
}

/// Rebuild an image from raw RGBA bytes, e.g. a GPU screenshot.
///
/// Returns `None` when the byte count does not match the dimensions, which is the one
/// way a capture can be malformed.
pub fn from_rgba(width: u32, height: u32, rgba: &[u8]) -> Option<RgbaImage> {
    RgbaImage::from_raw(width, height, rgba.to_vec())
}

pub fn decode_png(bytes: &[u8]) -> Result<RgbaImage, ImageError> {
    Ok(image::load_from_memory_with_format(bytes, image::ImageFormat::Png)?.to_rgba8())
}

fn similar(a: &Rgba<u8>, b: &Rgba<u8>, tolerance: u8) -> bool {
    a.0.iter()
        .zip(b.0.iter())
        .all(|(x, y)| x.abs_diff(*y) <= tolerance)
}

#[cfg(test)]
mod tests {
    use super::*;

    const WHITE: [u8; 4] = [255, 255, 255, 255];
    const RED: [u8; 4] = [200, 30, 30, 255];

    fn canvas_with_block(size: u32, block: (u32, u32), block_size: u32) -> RgbaImage {
        let mut img = RgbaImage::from_pixel(size, size, Rgba(WHITE));
        for y in block.1..block.1 + block_size {
            for x in block.0..block.0 + block_size {
                img.put_pixel(x, y, Rgba(RED));
            }
        }
        img
    }

    #[test]
    fn trims_to_the_block_and_keeps_its_size() {
        let img = canvas_with_block(20, (5, 7), 4);
        let trimmed = trim_to_content(&img, 0);
        assert_eq!(trimmed.dimensions(), (4, 4));
        assert_eq!(trimmed.get_pixel(0, 0), &Rgba(RED));
    }

    #[test]
    fn trimming_an_empty_capture_stays_non_degenerate() {
        let img = RgbaImage::from_pixel(16, 16, Rgba(WHITE));
        let trimmed = trim_to_content(&img, 0);
        assert_eq!(trimmed.dimensions(), (1, 1));
    }

    #[test]
    fn tolerance_ignores_near_background_noise() {
        // A ray-traced background is rarely perfectly flat; a tolerance keeps the grain
        // it leaves behind out of the crop. Here one near-white pixel sits in the far
        // corner: at tolerance 0 it stretches the crop down to that row, at 16 it is
        // treated as background and only the block survives.
        let mut img = canvas_with_block(12, (4, 4), 2);
        img.put_pixel(0, 11, Rgba([250, 250, 250, 255]));
        assert_eq!(trim_to_content(&img, 0).dimensions(), (6, 8));
        assert_eq!(trim_to_content(&img, 16).dimensions(), (2, 2));
    }

    #[test]
    fn padding_adds_the_margin_and_keeps_content_centred() {
        let img = canvas_with_block(10, (4, 4), 2);
        let out = pad(&img, 3, WHITE);
        assert_eq!(out.dimensions(), (16, 16));
        assert_eq!(out.get_pixel(7, 7), &Rgba(RED));
        assert_eq!(out.get_pixel(0, 0), &Rgba(WHITE));
    }

    #[test]
    fn aspect_padding_only_grows_the_short_side() {
        let img = RgbaImage::from_pixel(100, 50, Rgba(RED)); // 2:1
        let square = pad_to_aspect(&img, 1, 1, WHITE);
        assert_eq!(square.dimensions(), (100, 100));
        assert_eq!(square.get_pixel(50, 2), &Rgba(WHITE));
        assert_eq!(square.get_pixel(50, 50), &Rgba(RED));

        let same = pad_to_aspect(&img, 2, 1, WHITE);
        assert_eq!(same.dimensions(), (100, 50));
    }

    #[test]
    fn png_round_trip_preserves_pixels() {        let img = canvas_with_block(8, (2, 3), 3);
        let bytes = encode_png(&img).expect("encode");
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
        let back = decode_png(&bytes).expect("decode");
        assert_eq!(back, img);
    }

    #[test]
    fn framing_a_capture_drops_the_background_and_adds_a_margin() {
        // What a render actually looks like now: a flat background, then the molecule.
        // The earlier single-background version of this test had a grey band around the
        // scene, which only the previous renderer produced.
        let mut img = RgbaImage::from_pixel(60, 60, Rgba(WHITE));
        for y in 20..28 {
            for x in 24..30 {
                img.put_pixel(x, y, Rgba(RED));
            }
        }

        let figure = frame_figure(&img, 0.1);
        // 6×8 molecule plus 10% of its longer side (8 → 1 px) on each side.
        assert_eq!(figure.dimensions(), (8, 10));
        assert_eq!(figure.get_pixel(0, 0), &Rgba(WHITE));
        assert_eq!(figure.get_pixel(4, 5), &Rgba(RED));
    }

    #[test]
    fn framing_a_transparent_capture_keeps_transparency() {
        // A transparent export: the background is alpha 0, the molecule is opaque. If the
        // margin were filled white, cropping would silently undo the transparency.
        let mut img = RgbaImage::from_pixel(40, 40, Rgba([0, 0, 0, 0]));
        for y in 10..20 {
            for x in 12..18 {
                img.put_pixel(x, y, Rgba(RED));
            }
        }

        let figure = frame_figure_with(&img, 0.1, [0, 0, 0, 0]);
        assert_eq!(figure.dimensions(), (8, 12));
        assert_eq!(figure.get_pixel(0, 0).0[3], 0);
        assert_eq!(figure.get_pixel(4, 6), &Rgba(RED));
    }

    #[test]
    fn resizing_keeps_transparent_edges_from_turning_black() {
        // White opaque on the left, transparent on the right. Resized straight-alpha the
        // edge would blend toward black; premultiplied it stays white.
        let mut img = RgbaImage::from_pixel(8, 4, Rgba([0, 0, 0, 0]));
        for y in 0..4 {
            for x in 0..4 {
                img.put_pixel(x, y, Rgba(WHITE));
            }
        }

        let out = resize(&img, 2, 1);
        let edge = out.get_pixel(0, 0);
        // Downscaling blends the boundary, so alpha need not be a hard 255 — what matters
        // is that the colour was not dragged towards the transparent side's black.
        assert!(edge.0[3] > 200, "the opaque half lost its opacity: {:?}", edge);
        assert!(edge.0[0] > 240, "edge colour was darkened to {:?}", edge);
        assert!(out.get_pixel(1, 0).0[3] < 40, "the empty half must stay transparent");
    }

    #[test]
    fn resizing_an_opaque_image_averages_towards_the_middle() {
        // A 4×4 black/white checker halves to mid-grey: the point of supersampling.
        let mut img = RgbaImage::from_pixel(4, 4, Rgba([0, 0, 0, 255]));
        for y in 0..4 {
            for x in 0..4 {
                if (x + y) % 2 == 0 {
                    img.put_pixel(x, y, Rgba([255, 255, 255, 255]));
                }
            }
        }

        let out = resize(&img, 2, 2);
        for pixel in out.pixels() {
            let value = pixel.0[0];
            assert!((100..=155).contains(&value), "expected mid-grey, got {value}");
        }
    }

    #[test]
    fn framing_an_empty_capture_does_not_panic() {
        let img = RgbaImage::from_pixel(32, 32, Rgba([198, 198, 198, 255]));
        let figure = frame_figure(&img, 0.06);
        assert!(figure.width() >= 1 && figure.height() >= 1);
    }
}

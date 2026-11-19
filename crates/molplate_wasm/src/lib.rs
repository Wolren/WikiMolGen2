//! Browser bindings for molplate.
//!
//! Two jobs, both only meaningful on `wasm32`:
//!
//! 1. **Boot the renderer.** `molar_vis_core` is an eframe app; we start it on the
//!    page's animation-frame loop inside a host wrapper, with its own sidebar and
//!    toolbar hidden, so the canvas is just the molecule.
//! 2. **Drive it and get pixels out.** Every call becomes an `AppJob` — the viewer's own
//!    command channel — and the query helpers wait for the job to run on the UI thread.
//!    Images come back through egui's screenshot event, because upstream only offers a
//!    menu-driven export that downloads a file and discards the bytes.
//!
//! The wrapper exists instead of a fork: everything below the `App` type is upstream
//! `pub` API, and the screenshot request/response cycle is ordinary egui input.

#![cfg(target_arch = "wasm32")]

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::mpsc::{Receiver, Sender};

use futures_channel::oneshot;
use molar::prelude::{FileHandler, State, System as MSystem, Topology};
use molar_vis_core::eframe;
use molar_vis_core::eframe::egui;
use molar_vis_core::eframe::wgpu;
use molar_vis_core::{App, AppJob, AppLaunch, SharedSource};
use wasm_bindgen::prelude::*;

// Which graphics backend the adapter actually came up on, as reported by wgpu.\n//\n// wgpu prefers WebGPU and falls back to WebGL2; the difference matters to the user\n// (several effects need compute), so the page reports what it got.
thread_local! {
    static BACKEND: std::cell::RefCell<Option<wgpu::Backend>> = const { std::cell::RefCell::new(None) };
}

/// Frames to let egui settle after a resize before asking for the screenshot. The
/// surface size change lands on the next frame and the 3D pass needs one more to redraw
/// at the new size; capturing sooner yields a stale or half-sized image.
const DEFAULT_SETTLE_FRAMES: u32 = 3;

/// Where a capture request is in its lifecycle. Shared between the JS handle and the
/// host app, which run on the same thread.
enum Capture {
    Idle,
    /// Counting down to the screenshot command.
    Pending { frames_left: u32 },
    /// The screenshot request has been sent and we are waiting for the event.
    AwaitingScreenshot,
    Ready(Vec<u8>),
    Failed(String),
}

/// A [`SharedSource`] backed by an `Rc<System>`, so the viewer renders the parsed
/// molecule by reference instead of copying it into the scene.
///
/// `version` is a generation counter the viewer polls to re-render on a coordinate
/// edit; coordinates are static here, so it stays `0`.
struct WebSystemSource {
    system: Rc<MSystem>,
    version: Rc<Cell<u64>>,
}

impl SharedSource for WebSystemSource {
    fn topology(&self) -> &Topology {
        self.system.topology()
    }

    fn state(&self) -> &State {
        self.system.state()
    }

    fn coords_version(&self) -> u64 {
        self.version.get()
    }

    fn evaluate(&self, text: &str) -> Result<(molar::prelude::SelectionExpr, molar::prelude::Sel), molar_vis_core::EvalError> {
        molar_vis_core::evaluate(&self.system, text)
    }
}

/// The host app: upstream's viewer plus the screenshot plumbing.
struct Host {
    inner: App,
    capture: Rc<RefCell<Capture>>,
}

impl eframe::App for Host {
    fn ui(&mut self, ui: &mut egui::Ui, frame: &mut eframe::Frame) {
        // The viewer draws the scene and services queued jobs.
        eframe::App::ui(&mut self.inner, ui, frame);
        let ctx = ui.ctx().clone();
        self.service_capture(&ctx);
    }
}

impl Host {
    fn service_capture(&mut self, ctx: &egui::Context) {
        // A delivered screenshot arrives as an input event on a later frame.
        let shot = ctx.input(|input| {
            input.events.iter().find_map(|event| match event {
                egui::Event::Screenshot { image, .. } => Some(image.clone()),
                _ => None,
            })
        });

        let mut state = self.capture.borrow_mut();
        if let Some(image) = shot {
            if matches!(*state, Capture::AwaitingScreenshot) {
                let (width, height) = (image.size[0] as u32, image.size[1] as u32);
                *state = match molplate_core::image_ops::from_rgba(width, height, image.as_raw()) {
                    Some(rgba) => {
                        // The capture includes the viewer's own grey frame; the figure is
                        // the molecule with an even margin.
                        let figure = molplate_core::image_ops::frame_figure(&rgba, 0.06);
                        match molplate_core::image_ops::encode_png(&figure) {
                            Ok(bytes) => Capture::Ready(bytes),
                            Err(error) => Capture::Failed(error.to_string()),
                        }
                    }
                    None => Capture::Failed("screenshot pixel buffer had an unexpected size".into()),
                };
            }
            return;
        }

        match *state {
            Capture::Pending { frames_left } if frames_left > 1 => {
                *state = Capture::Pending {
                    frames_left: frames_left - 1,
                };
                drop(state);
                ctx.request_repaint();
            }
            Capture::Pending { .. } => {
                ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(Default::default()));
                *state = Capture::AwaitingScreenshot;
                drop(state);
                // The backend answers the request a frame later; keep frames coming.
                ctx.request_repaint();
            }
            Capture::AwaitingScreenshot => {
                drop(state);
                ctx.request_repaint();
            }
            _ => {}
        }
    }
}

/// Handle to the running viewer. One per page — upstream's `WebRunner` owns the winit
/// event loop, so a second `start` on the same page would fight it for the canvas.
#[wasm_bindgen]
pub struct Viewer {
    capture: Rc<RefCell<Capture>>,
    jobs: Sender<AppJob>,
}

#[wasm_bindgen]
impl Viewer {
    /// Parse one structure from bytes and show it alone, framed and with one
    /// representation.
    ///
    /// The format is taken from `name`'s extension (`sdf`, `pdb`, `mol`, `xyz`, …).
    /// Returns the atom count so the page can report what it loaded.
    #[wasm_bindgen(js_name = loadStructure)]
    pub async fn load_structure(&self, name: String, bytes: Vec<u8>) -> Result<u32, JsError> {
        let system = parse_structure(&name, bytes).map_err(|error| JsError::new(&error))?;
        let atoms = system.topology().atoms.len() as u32;
        let source = WebSystemSource {
            system: Rc::new(system),
            version: Rc::new(Cell::new(0)),
        };
        let mol_id = molar_vis_core::reserve_mol_id().0;

        query_job(&self.jobs, move |app: &mut App| {
            // One molecule at a time: the previous figure's scene (and camera) goes away
            // before the new one frames itself.
            app.clear();
            app.add_shared_molecule_with_id(mol_id, Box::new(source), name.clone())
                .map_err(|error| error.to_string())?;
            let rep = app.add_rep_default(0).map_err(|error| error.to_string())?;
            app.set_rep_color(0, rep, "element")
                .map_err(|error| error.to_string())?;
            Ok(atoms)
        })
        .await
    }

    /// Apply a look (style, colouring, material, width) to the current representation.
    ///
    /// Takes the same JSON the preset list returns, so the page can send a preset back
    /// unchanged or tweak one field.
    #[wasm_bindgen(js_name = applyLook)]
    pub async fn apply_look(&self, json: String) -> Result<(), JsError> {
        let look: molplate_core::Look =
            serde_json::from_str(&json).map_err(|error| JsError::new(&error.to_string()))?;
        let style = look.style.viewer_name();
        let color = look.color_mode.viewer_name();
        query_job(&self.jobs, move |app: &mut App| {
            app.set_rep_style(0, 0, style).map_err(|error| error.to_string())?;
            app.set_rep_color(0, 0, color).map_err(|error| error.to_string())?;
            if let Some(material) = look.material.as_deref() {
                app.set_rep_material(0, 0, material)
                    .map_err(|error| error.to_string())?;
            }
            if let Some(width) = look.line_width {
                app.set_rep_width(0, 0, width)
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })
        .await
    }

    /// Set the background to an sRGB colour in 0…1.
    #[wasm_bindgen(js_name = setBackground)]
    pub async fn set_background(&self, r: f32, g: f32, b: f32) -> Result<(), JsError> {
        query_job(&self.jobs, move |app: &mut App| {
            app.set_background_solid([r, g, b]);
            Ok(())
        })
        .await
    }

    /// Apply one of the viewer's element-colour presets: `Default`, `VMD`, `PyMOL`,
    /// `Discovery Studio`, `MOE` or `Mol*`.
    #[wasm_bindgen(js_name = setColorPreset)]
    pub async fn set_color_preset(&self, name: String) -> Result<(), JsError> {
        let preset = molar_vis_core::ColorPreset::parse(&name).map_err(|error| JsError::new(&error))?;
        query_job(&self.jobs, move |app: &mut App| {
            app.set_color_preset(preset).map_err(|error| error.to_string())
        })
        .await
    }

    /// Re-frame the camera around the whole scene, leaving a margin.
    ///
    /// A figure needs air around the molecule — upstream's own framing fills the
    /// viewport edge to edge, which crops atoms in a picture pasted into an infobox. The
    /// zoom-out factor is the margin.
    #[wasm_bindgen(js_name = frameScene)]
    pub async fn frame_scene(&self) -> Result<(), JsError> {
        query_job(&self.jobs, |app: &mut App| {
            app.reset_view();
            app.zoom_view(0.75);
            Ok(())
        })
        .await
    }

    /// Set the camera projection, `"perspective"` or `"orthographic"`.
    #[wasm_bindgen(js_name = setProjection)]
    pub async fn set_projection(&self, mode: String) -> Result<(), JsError> {
        let projection = molar_vis_core::parse_projection(&mode)
            .map_err(|error| JsError::new(&error))?;
        query_job(&self.jobs, move |app: &mut App| {
            app.set_projection(projection);
            Ok(())
        })
        .await
    }

    /// Ask for one PNG of the current view.
    ///
    /// The caller is expected to have resized the canvas to the wanted output size
    /// first: the screenshot is taken at surface resolution, which is what makes a
    /// 3000 px export possible without any offscreen-render API.
    #[wasm_bindgen(js_name = requestCapture)]
    pub fn request_capture(&self, settle_frames: Option<u32>) {
        let mut state = self.capture.borrow_mut();
        // A new request supersedes an unfinished one, but not a finished image the
        // page has not collected yet.
        if matches!(*state, Capture::Pending { .. } | Capture::AwaitingScreenshot) {
            return;
        }
        *state = Capture::Pending {
            frames_left: settle_frames.unwrap_or(DEFAULT_SETTLE_FRAMES).max(1),
        };
    }

    /// Collect the PNG from the last capture, or `undefined` while it is still coming.
    #[wasm_bindgen(js_name = takeCapture)]
    pub fn take_capture(&self) -> Option<Vec<u8>> {
        let mut state = self.capture.borrow_mut();
        match std::mem::replace(&mut *state, Capture::Idle) {
            Capture::Ready(bytes) => Some(bytes),
            other => {
                *state = other;
                None
            }
        }
    }

    /// `"idle" | "pending" | "ready" | "failed: …"` — for the UI's progress line.
    #[wasm_bindgen(js_name = captureStatus)]
    pub fn capture_status(&self) -> String {
        match &*self.capture.borrow() {
            Capture::Idle => "idle".into(),
            Capture::Pending { .. } | Capture::AwaitingScreenshot => "pending".into(),
            Capture::Ready(_) => "ready".into(),
            Capture::Failed(message) => format!("failed: {message}"),
        }
    }
}

/// Queue `job` and wait until the UI thread has run it.
async fn query_job<T, F>(jobs: &Sender<AppJob>, job: F) -> Result<T, JsError>
where
    T: 'static,
    F: FnOnce(&mut App) -> Result<T, String> + 'static,
{
    let (tx, rx) = oneshot::channel::<Result<T, String>>();
    jobs.send(Box::new(move |app: &mut App| {
        let _ = tx.send(job(app));
    }))
    .map_err(|_| JsError::new("viewer closed"))?;
    match rx.await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(message)) => Err(JsError::new(&message)),
        Err(_) => Err(JsError::new("viewer closed")),
    }
}

/// Parse the first structure record from `bytes`, choosing the reader by extension.
fn parse_structure(name: &str, bytes: Vec<u8>) -> Result<MSystem, String> {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let mut handler = FileHandler::from_reader(&ext, std::io::Cursor::new(bytes))
        .map_err(|error| format!("cannot read {name}: {}", molar_vis_core::error_chain(&error)))?;
    let (topology, state) = handler
        .read()
        .map_err(|error| format!("cannot parse {name}: {}", molar_vis_core::error_chain(&error)))?;
    MSystem::new(topology, state)
        .map_err(|error| format!("invalid structure in {name}: {}", molar_vis_core::error_chain(&error)))
}

/// Boot the viewer onto `<canvas id=…>` and resolve once graphics are initialized.
///
/// Two backends are supported. WebGPU is the one to use — transparency, ambient
/// occlusion, shadows and the ray tracer all need compute — and wgpu picks it whenever
/// `navigator.gpu` yields an adapter. WebGL2 is the fallback for browsers or GPUs without
/// WebGPU; it draws a correct raster image but loses those effects. Which one came up is
/// reported through [`graphics_backend`] so the page can say so instead of guessing.
#[wasm_bindgen]
pub async fn start(canvas_id: String) -> Result<Viewer, JsError> {
    console_error_panic_hook::set_once();
    let _ = console_log::init_with_level(log::Level::Info);

    let document = web_sys::window()
        .and_then(|window| window.document())
        .ok_or_else(|| JsError::new("no document"))?;
    let canvas = document
        .get_element_by_id(&canvas_id)
        .and_then(|element| {
            use wasm_bindgen::JsCast as _;
            element.dyn_into::<web_sys::HtmlCanvasElement>().ok()
        })
        .ok_or_else(|| JsError::new(&format!("page has no canvas {canvas_id:?}")))?;

    let (tx, rx): (Sender<AppJob>, Receiver<AppJob>) = std::sync::mpsc::channel();
    let capture = Rc::new(RefCell::new(Capture::Idle));
    let host_capture = capture.clone();

    eframe::WebRunner::new()
        .start(
            canvas,
            eframe::WebOptions::default(),
            Box::new(move |cc| {
                // Record the backend wgpu really chose, for the page to report.
                if let Some(render_state) = cc.wgpu_render_state.as_ref() {
                    let backend = render_state.adapter.get_info().backend;
                    BACKEND.with(|slot| *slot.borrow_mut() = Some(backend));
                }
                let mut app = App::new(cc, AppLaunch::default())?;
                // No sidebar, no toolbar: the page provides its own controls.
                app.set_ui_visibility(false, false);
                app.set_jobs(rx);
                Ok(Box::new(Host {
                    inner: app,
                    capture: host_capture,
                }) as Box<dyn eframe::App>)
            }),
        )
        .await
        .map_err(|error| JsError::new(&molar_vis_core::js_error_chain(&error)))?;

    // The viewer paints its own root surface, so a dark theme would outline every figure
    // with a dark frame. Queued as a job rather than set in the creation closure: theme
    // application needs a live frame.
    let _ = tx.send(Box::new(|app: &mut App| {
        if let Err(error) = app.set_theme("light") {
            log::warn!("could not switch the viewer to the light theme: {error}");
        }
    }));

    Ok(Viewer { capture, jobs: tx })
}

/// The backend the renderer actually started on, as a name the page can show:
/// `"WebGPU"`, `"WebGL2"`, or the raw wgpu name for anything unexpected.
#[wasm_bindgen(js_name = graphicsBackend)]
pub fn graphics_backend() -> String {
    BACKEND.with(|slot| match slot.borrow().clone() {
        Some(wgpu::Backend::BrowserWebGpu) => "WebGPU".to_string(),
        Some(wgpu::Backend::Gl) => "WebGL2".to_string(),
        Some(wgpu::Backend::Vulkan) => "Vulkan".to_string(),
        Some(wgpu::Backend::Dx12) => "DX12".to_string(),
        Some(wgpu::Backend::Metal) => "Metal".to_string(),
        Some(wgpu::Backend::Noop) => "none".to_string(),
        None => String::new(),
    })
}

// --- Presets and Wikipedia markup ---------------------------------------------------
//
// Free functions rather than methods on `Viewer`: they need no running renderer, so the
// page can build its preset buttons before (or without) a GPU context.

/// The built-in looks as JSON, for the UI's style picker.
#[wasm_bindgen(js_name = looksJson)]
pub fn looks_json() -> Result<String, JsError> {
    let looks = molplate_core::Look::small_molecule_looks();
    serde_json::to_string(&looks).map_err(|error| JsError::new(&error.to_string()))
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

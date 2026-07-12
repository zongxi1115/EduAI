use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct BackendProcess(Mutex<Option<Child>>);

/// Resolves the eduAI repo root so the backend's `.env` and relative
/// `OUTPUT_ROOT` are found regardless of the shell's cwd when Tauri launched
/// the app. `EDU_PROJECT_ROOT` overrides; otherwise this assumes the exe is
/// still sitting inside the repo at `edu-ai-frontend/src-tauri/target/<profile>/`,
/// which holds for `tauri dev`/`tauri build` run in place (not once the app
/// is installed to an unrelated location by the MSI/NSIS installer).
fn project_root() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("EDU_PROJECT_ROOT") {
        return Some(PathBuf::from(custom));
    }
    let exe = std::env::current_exe().ok()?;
    // <root>/edu-ai-frontend/src-tauri/target/<profile>/app.exe -> <root>
    exe.parent()?.parent()?.parent()?.parent()?.parent().map(PathBuf::from)
}

/// Starts the Python API gateway (`src/gateway`) as a child process so the
/// desktop app is self-contained. The backend command is resolved in order:
///
/// 1. `EDU_BACKEND_CMD` env var, if set — run verbatim through a shell.
/// 2. `conda run -n <EDU_CONDA_ENV|base> edu-prep-api --host <host> --port <port>`.
/// 3. `edu-prep-api --host <host> --port <port>` from PATH (e.g. an already
///    activated venv).
/// 4. `<EDU_PYTHON|python> -m uvicorn gateway.main:app --host <host> --port <port>`
///    — works even without a console-script entry point on PATH, as long as
///    `pip install -e .` was run with that interpreter.
///
/// This requires the machine to already have the Python environment set up
/// per the project README (`pip install -e .`) — Tauri only bundles the
/// frontend shell, not the Python runtime.
fn spawn_backend() -> Option<Child> {
    let host = std::env::var("EDU_BACKEND_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("EDU_BACKEND_PORT").unwrap_or_else(|_| "1234".to_string());
    let root = project_root();
    match &root {
        Some(r) => log::info!("resolved project root: {}", r.display()),
        None => log::warn!("could not resolve project root; backend cwd will be inherited"),
    }

    let apply_common = |cmd: &mut Command| {
        if let Some(r) = &root {
            cmd.current_dir(r);
        }
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
    };

    if let Ok(custom) = std::env::var("EDU_BACKEND_CMD") {
        log::info!("starting backend via EDU_BACKEND_CMD");
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/C", &custom]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", &custom]);
            c
        };
        apply_common(&mut cmd);
        return match cmd.spawn() {
            Ok(child) => Some(child),
            Err(e) => {
                log::error!("EDU_BACKEND_CMD failed to start: {e}");
                None
            }
        };
    }

    let conda_env = std::env::var("EDU_CONDA_ENV").unwrap_or_else(|_| "base".to_string());
    let mut conda_cmd = Command::new("conda");
    conda_cmd.args([
        "run",
        "-n",
        &conda_env,
        "--no-capture-output",
        "edu-prep-api",
        "--host",
        &host,
        "--port",
        &port,
    ]);
    apply_common(&mut conda_cmd);

    match conda_cmd.spawn() {
        Ok(child) => {
            log::info!("backend started via `conda run -n {conda_env} edu-prep-api`");
            return Some(child);
        }
        Err(e) => {
            log::warn!("conda launch failed ({e}), falling back to `edu-prep-api` on PATH");
        }
    }

    let mut direct_cmd = Command::new("edu-prep-api");
    direct_cmd.args(["--host", &host, "--port", &port]);
    apply_common(&mut direct_cmd);

    match direct_cmd.spawn() {
        Ok(child) => {
            log::info!("backend started via `edu-prep-api` on PATH");
            return Some(child);
        }
        Err(e) => {
            log::warn!(
                "`edu-prep-api` not on PATH ({e}), falling back to `python -m uvicorn`"
            );
        }
    }

    let python_bin = std::env::var("EDU_PYTHON").unwrap_or_else(|_| "python".to_string());
    let mut python_cmd = Command::new(&python_bin);
    python_cmd.args([
        "-m",
        "uvicorn",
        "gateway.main:app",
        "--host",
        &host,
        "--port",
        &port,
    ]);
    apply_common(&mut python_cmd);

    match python_cmd.spawn() {
        Ok(child) => {
            log::info!("backend started via `{python_bin} -m uvicorn gateway.main:app`");
            Some(child)
        }
        Err(e) => {
            log::error!(
                "could not start the backend automatically ({e}). Start it manually, e.g. \
                 `conda run -n base edu-prep-api --host {host} --port {port}`, or set EDU_BACKEND_CMD."
            );
            None
        }
    }
}

/// Kills the backend process (and, on Windows, the whole process tree it
/// spawned via `conda run`, which `Child::kill` alone would not reach).
fn kill_backend(child: &mut Child) {
    #[cfg(windows)]
    {
        let pid = child.id().to_string();
        let _ = Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            let mut log_builder = tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: None },
                ));
            if cfg!(debug_assertions) {
                log_builder = log_builder.target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ));
            }
            app.handle().plugin(log_builder.build())?;

            let child = spawn_backend();
            *app.state::<BackendProcess>().0.lock().unwrap() = child;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<BackendProcess>();
                let mut guard = state.0.lock().unwrap();
                if let Some(mut child) = guard.take() {
                    kill_backend(&mut child);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

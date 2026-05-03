use serde::Serialize;
use std::{
  fs,
  env,
  net::{SocketAddr, TcpStream},
  path::PathBuf,
  process::Command,
  time::Duration,
};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatus {
  tauri_mode: bool,
  project_root: Option<String>,
  runtime_source: String,
  app_data_dir: Option<String>,
  docker_available: bool,
  compose_available: bool,
  backend_host: String,
  backend_port: u16,
  backend_reachable: bool,
  message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopLogs {
  source: String,
  content: String,
}

struct RuntimeContext {
  root: PathBuf,
  compose_file: PathBuf,
  runtime_source: &'static str,
  app_data_dir: PathBuf,
  backend_port: u16,
  ollama_port: u16,
}

fn backend_port() -> u16 {
  env::var("API_PORT")
    .ok()
    .and_then(|value| value.parse::<u16>().ok())
    .unwrap_or(8000)
}

fn ollama_port() -> u16 {
  env::var("OLLAMA_PORT")
    .ok()
    .and_then(|value| value.parse::<u16>().ok())
    .unwrap_or(11434)
}

fn backend_reachable(port: u16) -> bool {
  let address = SocketAddr::from(([127, 0, 0, 1], port));
  TcpStream::connect_timeout(&address, Duration::from_millis(800)).is_ok()
}

fn command_ok(command: &str, args: &[&str], cwd: Option<&PathBuf>) -> bool {
  let mut process = Command::new(command);
  process.args(args);
  if let Some(path) = cwd {
    process.current_dir(path);
  }
  process.output().map(|output| output.status.success()).unwrap_or(false)
}

fn packaged_runtime_root(app: &tauri::AppHandle) -> Option<PathBuf> {
  app.path().resource_dir().ok().map(|path| path.join("desktop-runtime"))
}

fn runtime_context(app: &tauri::AppHandle) -> Result<RuntimeContext, String> {
  let backend_port = backend_port();
  let ollama_port = ollama_port();
  let (root, runtime_source) = if let Some(path) = env::var("EXTRACTFLOW_PROJECT_ROOT").ok().map(PathBuf::from) {
    (path, "repo_checkout")
  } else if let Some(path) = packaged_runtime_root(app) {
    (path, "bundled_resources")
  } else {
    return Err("No ExtractFlow runtime payload is available.".to_string());
  };

  let compose_file = root.join("docker-compose.desktop.yml");
  if !compose_file.exists() {
    return Err(format!("Desktop compose file is missing at {}.", compose_file.display()));
  }

  let app_data_dir = if let Ok(path) = env::var("EXTRACTFLOW_APP_DATA_DIR") {
    PathBuf::from(path)
  } else {
    app.path()
      .app_data_dir()
      .map_err(|error| format!("Could not resolve app data directory: {error}"))?
      .join("runtime-data")
  };
  fs::create_dir_all(&app_data_dir).map_err(|error| format!("Could not create runtime data directory: {error}"))?;

  Ok(RuntimeContext {
    root,
    compose_file,
    runtime_source,
    app_data_dir,
    backend_port,
    ollama_port,
  })
}

fn open_path(path: &PathBuf) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  let program = "open";
  #[cfg(target_os = "linux")]
  let program = "xdg-open";
  #[cfg(target_os = "windows")]
  let program = "explorer";

  let status = Command::new(program)
    .arg(path)
    .status()
    .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;

  if status.success() {
    Ok(())
  } else {
    Err(format!("Could not open {}", path.display()))
  }
}

fn compose_command(context: &RuntimeContext) -> Command {
  let mut command = Command::new("docker");
  command
    .args(["compose", "-f"])
    .arg(&context.compose_file)
    .args(["-p", "extractflow-desktop"])
    .env("API_PORT", context.backend_port.to_string())
    .env("OLLAMA_PORT", context.ollama_port.to_string())
    .env("EXTRACTFLOW_APP_DATA_DIR", &context.app_data_dir)
    .env("SEED_SAMPLES_ON_STARTUP", env::var("SEED_SAMPLES_ON_STARTUP").unwrap_or_else(|_| "true".to_string()))
    .current_dir(&context.root);
  command
}

fn run_compose_capture(context: &RuntimeContext, args: &[&str]) -> Result<String, String> {
  let output = compose_command(context)
    .args(args)
    .output()
    .map_err(|error| format!("Failed to run docker compose command: {error}"))?;

  if output.status.success() {
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
  } else {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
      Err(format!("docker compose command exited with status {}", output.status))
    } else {
      Err(stderr)
    }
  }
}

fn desktop_status(app: &tauri::AppHandle) -> DesktopStatus {
  let context = runtime_context(app).ok();
  let docker_available = command_ok("docker", &["info"], None);
  let compose_available = command_ok("docker", &["compose", "version"], None);
  let port = context.as_ref().map(|value| value.backend_port).unwrap_or_else(backend_port);
  let reachable = backend_reachable(port);
  let message = if context.is_none() {
    "Desktop shell is running without a bundled or configured runtime payload.".to_string()
  } else if !docker_available {
    "Docker daemon is not available for desktop-managed backend startup.".to_string()
  } else if !compose_available {
    "Docker Compose is unavailable.".to_string()
  } else if reachable {
    "Local backend is reachable.".to_string()
  } else {
    "Local backend is not reachable. You can start the local stack from the desktop shell.".to_string()
  };

  DesktopStatus {
    tauri_mode: true,
    project_root: context.as_ref().map(|value| value.root.display().to_string()),
    runtime_source: context
      .as_ref()
      .map(|value| value.runtime_source.to_string())
      .unwrap_or_else(|| "unavailable".to_string()),
    app_data_dir: context.as_ref().map(|value| value.app_data_dir.display().to_string()),
    docker_available,
    compose_available,
    backend_host: "127.0.0.1".to_string(),
    backend_port: port,
    backend_reachable: reachable,
    message,
  }
}

#[tauri::command]
fn get_desktop_status(app: tauri::AppHandle) -> DesktopStatus {
  desktop_status(&app)
}

#[tauri::command]
fn start_local_stack(app: tauri::AppHandle) -> Result<DesktopStatus, String> {
  let context = runtime_context(&app)?;
  let status = compose_command(&context)
    .args(["up", "--build", "-d", "backend", "worker"])
    .status()
    .map_err(|error| format!("Failed to start local stack: {error}"))?;

  if !status.success() {
    return Err("docker compose up -d backend worker failed.".to_string());
  }

  Ok(desktop_status(&app))
}

#[tauri::command]
fn restart_local_stack(app: tauri::AppHandle) -> Result<DesktopStatus, String> {
  let context = runtime_context(&app)?;
  let status = compose_command(&context)
    .args(["restart", "backend", "worker"])
    .status()
    .map_err(|error| format!("Failed to restart local stack: {error}"))?;

  if !status.success() {
    return Err("docker compose restart backend worker failed.".to_string());
  }

  Ok(desktop_status(&app))
}

#[tauri::command]
fn stop_local_stack(app: tauri::AppHandle) -> Result<DesktopStatus, String> {
  let context = runtime_context(&app)?;
  let status = compose_command(&context)
    .args(["stop", "backend", "worker"])
    .status()
    .map_err(|error| format!("Failed to stop local stack: {error}"))?;

  if !status.success() {
    return Err("docker compose stop backend worker failed.".to_string());
  }

  Ok(desktop_status(&app))
}

#[tauri::command]
fn open_project_root(app: tauri::AppHandle) -> Result<(), String> {
  let context = runtime_context(&app)?;
  open_path(&context.root)
}

#[tauri::command]
fn open_app_data_dir(app: tauri::AppHandle) -> Result<(), String> {
  let context = runtime_context(&app)?;
  open_path(&context.app_data_dir)
}

#[tauri::command]
fn get_backend_logs(app: tauri::AppHandle) -> Result<DesktopLogs, String> {
  let context = runtime_context(&app)?;
  let compose_file = context.compose_file.display().to_string();
  let content = run_compose_capture(&context, &["logs", "--tail", "120", "backend", "worker"])?;

  Ok(DesktopLogs {
    source: format!("docker compose -f {compose_file} logs --tail 120 backend worker"),
    content,
  })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      get_desktop_status,
      start_local_stack,
      restart_local_stack,
      stop_local_stack,
      open_project_root,
      open_app_data_dir,
      get_backend_logs
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

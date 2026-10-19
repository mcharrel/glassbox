use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
fn helper(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("server/link-router/rev Links.app/Contents/MacOS/rev-links"))
}

#[cfg(target_os = "macos")]
fn command(app: &AppHandle, args: &[&str]) -> Result<serde_json::Value, String> {
    let output = std::process::Command::new(helper(app)?)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Could not configure macOS link routing.".into());
    }
    serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pr_link_routing(app: AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(move || command(&app, &["--status"]))
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(
            serde_json::json!({"supported": false, "enabled": true, "registered": false, "browser": "your browser"}),
        )
    }
}

#[tauri::command]
pub async fn set_pr_link_routing(
    app: AppHandle,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(move || {
        command(&app, &[if enabled { "--enable" } else { "--disable" }])
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, enabled);
        Err("PR link routing requires macOS.".into())
    }
}

#[tauri::command]
pub async fn open_link_in_browser(app: AppHandle, url: String) -> Result<bool, String> {
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only web links can open in a browser.".into());
    }
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(move || {
        let result = std::process::Command::new(helper(&app)?)
            .args(["--browser", &url])
            .status()
            .map_err(|e| e.to_string())?;
        if result.success() {
            Ok(true)
        } else {
            Err("Could not open the browser.".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(false)
    }
}

pub fn initialise(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let Ok(path) = helper(&app) else {
                return;
            };
            let args: Vec<String> = std::env::args().collect();
            if let Some(root) = args
                .iter()
                .position(|arg| arg == "--project-dir")
                .and_then(|i| args.get(i + 1))
            {
                let _ = std::process::Command::new(&path)
                    .args(["--remember-workspace", root])
                    .status();
            }
            let _ = std::process::Command::new(path)
                .arg("--auto-enable")
                .output();
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

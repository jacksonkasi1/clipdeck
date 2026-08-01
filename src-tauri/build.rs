fn main() {
    tauri_build::build();

    // The Tauri 2 bundler auto-includes `WebView2Loader.dll` for the
    // `*-gnu` Windows target, but only when the DLL is reachable at
    // `target/<profile>/WebView2Loader.dll`. `webview2-com-sys` drops
    // the SDK file under `build/webview2-com-sys-*/out/<arch>/`, so we
    // copy the x64 build into the expected top-level location for the
    // bundler to pick up.
    copy_webview2_loader();
}

#[cfg(target_os = "windows")]
fn copy_webview2_loader() {
    use std::path::PathBuf;

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "release".into());
    let target_dir = manifest_dir.join("target").join(&profile);
    let dst = target_dir.join("WebView2Loader.dll");
    if dst.exists() {
        return;
    }

    let build_dir = target_dir.join("build");
    let Ok(entries) = std::fs::read_dir(&build_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("webview2-com-sys-") {
            continue;
        }
        let candidate = entry
            .path()
            .join("out")
            .join("x64")
            .join("WebView2Loader.dll");
        if candidate.exists() {
            if let Err(error) = std::fs::copy(&candidate, &dst) {
                eprintln!(
                    "cargo:warning=Could not copy WebView2Loader.dll to {}: {}",
                    dst.display(),
                    error,
                );
            } else {
                println!("cargo:rerun-if-changed={}", candidate.display());
            }
            return;
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn copy_webview2_loader() {}

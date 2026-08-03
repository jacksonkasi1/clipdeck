//! Best-effort Windows application discovery for the ignored-app picker.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::models::{ApplicationInfo, IgnoredApp};

const CACHE_TTL: Duration = Duration::from_secs(30);
/// Timestamped snapshot of the installed-application scan.
type InstalledSnapshot = Option<(Instant, Vec<ApplicationInfo>)>;

static INSTALLED_CACHE: OnceLock<Mutex<InstalledSnapshot>> = OnceLock::new();

pub fn resolve(executable_path: &str) -> Option<IgnoredApp> {
    let path = PathBuf::from(executable_path.trim().trim_matches('"'));
    if path.as_os_str().is_empty() {
        return None;
    }
    Some(identity_for_path(&path))
}

pub fn running() -> Vec<ApplicationInfo> {
    let system = sysinfo::System::new_all();
    let mut apps = BTreeMap::new();
    for process in system.processes().values() {
        let Some(path) = process.exe() else { continue };
        if path.as_os_str().is_empty() || !path.exists() {
            continue;
        }
        let identity = identity_for_path(path);
        apps.entry(identity.id.clone()).or_insert(ApplicationInfo {
            identity,
            publisher: None,
            running: true,
            installed: false,
            recently_used: None,
        });
    }
    apps.into_values().collect()
}

pub fn installed(refresh: bool) -> Vec<ApplicationInfo> {
    let cache = INSTALLED_CACHE.get_or_init(|| Mutex::new(None));
    if !refresh {
        if let Ok(guard) = cache.lock() {
            if let Some((created, apps)) = guard.as_ref() {
                if created.elapsed() < CACHE_TTL {
                    return apps.clone();
                }
            }
        }
    }

    let mut apps: BTreeMap<String, ApplicationInfo> = running()
        .into_iter()
        .map(|app| (app.identity.id.clone(), app))
        .collect();
    discover_uninstall_registry(&mut apps);
    discover_start_menu_executables(&mut apps);
    discover_packaged_apps(&mut apps);
    let result: Vec<_> = apps.into_values().collect();
    if let Ok(mut guard) = cache.lock() {
        *guard = Some((Instant::now(), result.clone()));
    }
    result
}

/// Extracts an executable's icon to a cache directory and returns the absolute
/// PNG path. Used both by the application-picker (`ignoredApps`) and by the
/// source-app attribution pipeline; the result is keyed by the canonical path
/// so the same executable resolves to a single icon across both code paths.
pub fn extract_icon_into(executable_path: &str, cache_root: &Path) -> Option<String> {
    use sha2::{Digest, Sha256};

    let executable = Path::new(executable_path);
    if !executable.is_file() {
        return None;
    }
    std::fs::create_dir_all(cache_root).ok()?;
    let digest = Sha256::digest(super::source::normalize_path(executable).as_bytes());
    let icon_path = cache_root.join(format!("{digest:x}.png"));
    if icon_path.is_file() {
        return Some(icon_path.to_string_lossy().into_owned());
    }

    let script = r#"Add-Type -AssemblyName System.Drawing; $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($args[0]); if ($null -eq $icon) { exit 2 }; $bitmap = $icon.ToBitmap(); $bitmap.Save($args[1], [System.Drawing.Imaging.ImageFormat]::Png); $bitmap.Dispose(); $icon.Dispose()"#;
    let status = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .arg(executable)
        .arg(&icon_path)
        .status()
        .ok()?;
    (status.success() && icon_path.is_file()).then(|| icon_path.to_string_lossy().into_owned())
}

fn identity_for_path(path: &Path) -> IgnoredApp {
    let normalized = super::source::normalize_path(path);
    let executable_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let display_name = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or(&executable_name)
        .to_string();
    IgnoredApp {
        id: format!("exe:{normalized}"),
        display_name,
        executable_path: path.to_string_lossy().into_owned(),
        executable_name,
        app_user_model_id: None,
        package_family_name: None,
        icon_path: None,
    }
}

fn insert_path(
    apps: &mut BTreeMap<String, ApplicationInfo>,
    path: PathBuf,
    display_name: Option<String>,
    publisher: Option<String>,
) {
    if path
        .extension()
        .is_none_or(|ext| !ext.eq_ignore_ascii_case("exe"))
    {
        return;
    }
    let mut identity = identity_for_path(&path);
    if let Some(name) = display_name.filter(|name| !name.trim().is_empty()) {
        identity.display_name = name;
    }
    apps.entry(identity.id.clone())
        .and_modify(|app| {
            app.installed = true;
            if publisher.is_some() {
                app.publisher = publisher.clone();
            }
            if !identity.display_name.is_empty() {
                app.identity.display_name = identity.display_name.clone();
            }
        })
        .or_insert(ApplicationInfo {
            identity,
            publisher,
            running: false,
            installed: true,
            recently_used: None,
        });
}

fn discover_uninstall_registry(apps: &mut BTreeMap<String, ApplicationInfo>) {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    const KEYS: [&str; 2] = [
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let root = RegKey::predef(hive);
        for key_name in KEYS {
            let Ok(key) = root.open_subkey(key_name) else {
                continue;
            };
            for child_name in key.enum_keys().flatten() {
                let Ok(child) = key.open_subkey(child_name) else {
                    continue;
                };
                let display_name: Option<String> = child.get_value("DisplayName").ok();
                let publisher: Option<String> = child.get_value("Publisher").ok();
                let Some(raw): Option<String> = child.get_value("DisplayIcon").ok() else {
                    continue;
                };
                let path = raw.trim().trim_matches('"').split(',').next().unwrap_or("");
                insert_path(apps, PathBuf::from(path), display_name, publisher);
            }
        }
    }
}

fn discover_start_menu_executables(apps: &mut BTreeMap<String, ApplicationInfo>) {
    let script = r#"$shell = New-Object -ComObject WScript.Shell; Get-ChildItem @($env:APPDATA + '\Microsoft\Windows\Start Menu\Programs', $env:PROGRAMDATA + '\Microsoft\Windows\Start Menu\Programs') -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $shortcut = $shell.CreateShortcut($_.FullName); if ($shortcut.TargetPath -like '*.exe') { [pscustomobject]@{ Name = $_.BaseName; Path = $shortcut.TargetPath } } } | ConvertTo-Json -Compress"#;
    if let Ok(output) = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
    {
        if output.status.success() {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                let entries: Vec<&serde_json::Value> = match &value {
                    serde_json::Value::Array(values) => values.iter().collect(),
                    serde_json::Value::Object(_) => vec![&value],
                    _ => Vec::new(),
                };
                for entry in entries {
                    if let Some(path) = entry.get("Path").and_then(serde_json::Value::as_str) {
                        insert_path(
                            apps,
                            PathBuf::from(path),
                            entry
                                .get("Name")
                                .and_then(serde_json::Value::as_str)
                                .map(str::to_string),
                            None,
                        );
                    }
                }
            }
        }
    }

    for root in [
        std::env::var_os("APPDATA").map(PathBuf::from),
        std::env::var_os("PROGRAMDATA").map(PathBuf::from),
    ]
    .into_iter()
    .flatten()
    .map(|root| root.join(r"Microsoft\Windows\Start Menu\Programs"))
    {
        walk_executables(&root, 0, apps);
    }
}

fn walk_executables(directory: &Path, depth: usize, apps: &mut BTreeMap<String, ApplicationInfo>) {
    if depth > 6 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_executables(&path, depth + 1, apps);
        } else {
            insert_path(apps, path, None, None);
        }
    }
}

fn discover_packaged_apps(apps: &mut BTreeMap<String, ApplicationInfo>) {
    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress",
        ])
        .output();
    let Ok(output) = output else { return };
    if !output.status.success() {
        return;
    }
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return;
    };
    let entries: Vec<&serde_json::Value> = match &value {
        serde_json::Value::Array(values) => values.iter().collect(),
        serde_json::Value::Object(_) => vec![&value],
        _ => return,
    };
    for entry in entries {
        let Some(app_id) = entry.get("AppID").and_then(|value| value.as_str()) else {
            continue;
        };
        let display_name = entry
            .get("Name")
            .and_then(|value| value.as_str())
            .unwrap_or(app_id)
            .to_string();
        let identity = IgnoredApp {
            id: format!("aumid:{}", app_id.to_lowercase()),
            display_name,
            executable_path: String::new(),
            executable_name: String::new(),
            app_user_model_id: Some(app_id.to_string()),
            package_family_name: app_id.split('!').next().map(str::to_string),
            icon_path: None,
        };
        apps.entry(identity.id.clone()).or_insert(ApplicationInfo {
            identity,
            publisher: None,
            running: false,
            installed: true,
            recently_used: None,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_icon_into_returns_none_for_missing_files() {
        let temp = std::env::temp_dir().join("clipmo-icon-test-missing");
        let _ = std::fs::create_dir_all(&temp);
        let result = extract_icon_into(r"C:\does\not\exist.exe", &temp);
        assert!(result.is_none());
        let _ = std::fs::remove_dir_all(&temp);
    }
}

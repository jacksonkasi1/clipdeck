# Windows validation and release

Clipdeck's authoritative release environment is a GitHub-hosted Windows runner
using `x86_64-pc-windows-msvc`. The only public Windows distribution asset is:

- `Clipdeck_0.2.1_x64-setup.exe`

Portable publication is disabled. Do not upload a raw executable or portable ZIP
until that package can automatically install WebView2 when the runtime is absent.
Users must never be sent to a browser to install a runtime manually.

## WebView2 policy

Installed builds rely on Tauri's NSIS configuration in `tauri.conf.json`:

```json
"webviewInstallMode": { "type": "downloadBootstrapper" }
```

The application does not perform a handwritten registry preflight and does not
block Tauri startup. The installer is responsible for detecting and installing
Microsoft Edge WebView2 Runtime before Clipdeck starts.

## What CI verifies

A successful Windows CI/release run builds and tests the frontend, formats,
lints, and tests Rust, builds the NSIS installer, then runs
`collect-windows-artifacts.ps1`. The collector:

1. resolves Cargo's exact target directory and release target triple;
2. validates the version in package, Tauri, Cargo manifest, and lock files;
3. rejects missing, empty, oversized, or non-x64 build outputs;
4. starts from an empty artifact directory and copies the exact NSIS installer;
5. silently uninstalls an existing Clipdeck installation, if present;
6. silently installs the newly built installer;
7. resolves and launches the installed Start Menu shortcut;
8. waits for a readiness file written only after the main Tauri webview has
   completed initial store boot and React has mounted;
9. validates the readiness PID, main-window label, and visible main window;
10. fails if a WebView2 dialog appears or readiness/window creation times out;
11. captures `Clipdeck_0.2.1_startup.png` from the real Clipdeck window; and
12. uninstalls the tested build.

The retained workflow artifact contains the tested installer and startup
screenshot. Tagged GitHub releases publish only the installer.

## Local production build

```powershell
npm ci
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --locked --all-targets -- --test-threads=1
npx tauri build --ci --target x86_64-pc-windows-msvc --bundles nsis
./scripts/collect-windows-artifacts.ps1 -TargetTriple x86_64-pc-windows-msvc -ExpectedVersion 0.2.1
```

## Release verification matrix

Hosted Windows runners normally already contain WebView2. Their fresh Clipdeck
install and Start Menu test proves the runtime-present path, frontend boot, and
real main-window creation. It does **not** prove bootstrap installation on a
runtime-absent machine.

Before promoting a release, record this additional test on a clean supported
Windows VM where WebView2 is confirmed absent:

1. verify Clipdeck is uninstalled;
2. verify WebView2 Runtime is absent;
3. run the exact generated `Clipdeck_0.2.1_x64-setup.exe` with network access;
4. verify the installer obtains WebView2 without opening a browser;
5. launch Clipdeck from its Start Menu shortcut;
6. verify the real Clipdeck UI appears; and
7. record Windows version, resulting WebView2 version, installer SHA-256, and a
   screenshot/video.

Do not claim the runtime-absent test passed from hosted CI alone. If that clean-VM
result is unavailable, report it as an explicit release blocker.

Windows artifacts remain unsigned unless repository signing is configured, so
users may see a SmartScreen warning.

References:

- [Tauri Windows installer guide](https://v2.tauri.app/distribute/windows-installer/)
- [Microsoft WebView2 distribution](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)

# Windows validation and release

Clipdeck's authoritative release environment is a GitHub-hosted Windows runner
using `x86_64-pc-windows-msvc`. The only public distribution assets for 0.2.1
are named exactly:

- `Clipdeck_0.2.1_x64-setup.exe`
- `Clipdeck_0.2.1_portable_x64.zip`

A raw build executable renamed as a "portable" executable is **not** a portable
package. That was the previous release mistake: it omitted the payload layout,
portable instructions, and any dynamically required loader. Never upload
`clipdeck.exe` or a renamed raw executable to a GitHub release.

## What CI verifies

A successful Windows CI/release run builds the frontend, tests and lints Rust,
builds the NSIS installer, and then runs `collect-windows-artifacts.ps1`. The
collector:

1. obtains Cargo's exact target directory (including configured or explicit
   `CARGO_TARGET_DIR`) and uses the exact target-triple release path;
2. checks `package.json`, `Cargo.toml`, `tauri.conf.json`, `Cargo.lock`, and the
   release tag version;
3. rejects missing/empty outputs and non-x64 PE executable/DLL payloads;
4. examines the executable's PE imports and includes the x64
   `WebView2Loader.dll` only when it is dynamically required;
5. starts with clean output/staging directories and creates one `Clipdeck/`
   root, rejecting extra or nested paths;
6. unzips the completed archive, revalidates the exact payload, and starts
   `Clipdeck.exe` from that extracted directory; and
7. uploads only the installer and portable ZIP, preserving them as separate
   assets.

The expected archive listing for the MSVC release is:

```text
Clipdeck/
Clipdeck/Clipdeck.exe
Clipdeck/README-portable.txt
```

If PE imports show that a toolchain dynamically requires the loader, the one
additional expected entry is:

```text
Clipdeck/WebView2Loader.dll
```

No `Clipdeck/Clipdeck/`, raw executable beside `Clipdeck/`, empty loader, or
other stale file is valid.

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

The collector prints both release assets and the extracted ZIP listing. Use
`-TargetDirectory` only to override Cargo discovery deliberately. A manual
**Windows Release** dispatch creates a retained release candidate without
publishing it.

## WebView2 runtime validation

GitHub-hosted Windows runners already have Microsoft Edge WebView2 Runtime.
Their startup smoke test proves that the extracted payload works with the
runtime present; it cannot prove the missing-runtime experience. The portable
README directs users to Microsoft's Evergreen Runtime download. Adding an
application-owned message box before Tauri initializes requires coordinated
backend startup work outside packaging files and must not be simulated by the
packager.

Before promoting a release, perform this clean-VM/manual matrix:

| Machine | Runtime | Package | Expected result |
|---|---|---|---|
| Clean Windows 11 x64 VM | Inbox/current | Portable ZIP | Extract and start successfully |
| Clean supported Windows x64 VM | Absent | Portable ZIP | Startup fails; README provides the Evergreen install path |
| Same VM after Evergreen install | Current | Portable ZIP | Starts without changing ZIP contents |
| Clean supported Windows x64 VM | Absent | NSIS installer | Installer downloads/installs runtime, then app starts |
| Offline managed VM | Predeployed x64 Evergreen | Both | Starts without network access |

Record the Windows version, WebView2 runtime version/absence, package name, and
result in the release checklist.

## Release procedure and v0.2.0 cleanup

1. Ensure all four version files are 0.2.1 and Windows CI passes on the exact
   commit.
2. Create and push annotated tag `v0.2.1`; the workflow also rejects a tag/version
   mismatch.
3. Confirm the release contains exactly the two asset names at the top of this
   document and that the printed ZIP listing matches.
4. In release notes, call out that 0.2.1 replaces the misleading 0.2.0 raw
   "portable" executable with a complete ZIP.
5. Separately and manually remove the obsolete raw portable asset from the
   v0.2.0 GitHub release (or mark it unsupported) after 0.2.1 is available. Do
   not automate mutation of the old release from the build workflow.

Windows artifacts remain unsigned unless repository signing is configured;
users may therefore see a SmartScreen warning.

References:

- [Tauri GitHub pipeline guide](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri Windows installer guide](https://v2.tauri.app/distribute/windows-installer/)
- [Microsoft WebView2 distribution](https://developer.microsoft.com/microsoft-edge/webview2/)

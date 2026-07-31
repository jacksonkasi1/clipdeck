# Windows validation and release

Clipdeck’s authoritative native test and release environment is a GitHub-hosted
Windows runner using the `x86_64-pc-windows-msvc` target. This matches the
supported production toolchain and supplies the Windows SDK and WebView2 runtime
needed by the Tauri test executable.

## Continuous integration

`.github/workflows/ci.yml` runs for pull requests, `main`, feature/fix branches,
and manual dispatches. A successful run proves that the same commit passed:

1. locked npm installation and the TypeScript/Vite production build;
2. Rust formatting and Clippy with warnings denied;
3. the complete Rust test suite on Windows MSVC, one test at a time;
4. a release-mode Tauri build and NSIS bundle;
5. a short startup smoke test of the packaged executable;
6. artifact existence, release-size budget, version, and SHA-256 verification.

The run uploads a tested portable executable, NSIS installer,
`SHA256SUMS.txt`, and `build-metadata.json` for 14 days.

If a local GNU test executable exits with `STATUS_ENTRYPOINT_NOT_FOUND`, do not
treat compile-only output as a passed test. Dispatch **Windows CI** from GitHub
and require its MSVC test job to pass. Local GNU builds remain useful for fast
development, while MSVC CI is the release gate.

## Local production build

On a machine with Visual Studio Build Tools and the Windows SDK:

```powershell
npm ci
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --locked --all-targets -- --test-threads=1
npx tauri build --ci --target x86_64-pc-windows-msvc --bundles nsis
./scripts/smoke-test-windows.ps1 -Executable src-tauri/target/x86_64-pc-windows-msvc/release/clipdeck.exe
./scripts/collect-windows-artifacts.ps1 -TargetTriple x86_64-pc-windows-msvc
```

The collector refuses to package a build when the versions in
`package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` differ.
It also enforces default production budgets of 32 MB for the executable and
16 MB for the installer so debug-sized or accidentally bloated artifacts can
never be published unnoticed.

## Release procedure

1. Complete the Windows CI gate on the exact commit to release.
2. Update all three application version fields to the same semantic version.
3. Create and push an annotated tag named `v<version>`.
4. The **Windows Release** workflow repeats every validation and build check.
5. The workflow downloads its immutable verified artifact into the publish job
   and creates the GitHub release with the executable, installer, checksums, and
   build metadata.

A manual **Windows Release** dispatch builds and retains the same verified
artifact without publishing a GitHub release. This is the safe path for release
candidate checks.

Windows artifacts are currently unsigned unless Authenticode signing is
configured for the repository. `build-metadata.json` records the signature
status so an unsigned file cannot be mistaken for a signed distribution.

References:

- [Tauri GitHub pipeline guide](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri Windows installer guide](https://v2.tauri.app/distribute/windows-installer/)
- [GitHub Actions artifact documentation](https://docs.github.com/actions/using-workflows/storing-workflow-data-as-artifacts)

# Clipmo — cross-device release checklist

This branch completes the desktop same-network sync work planned for the Clipmo 0.2 line. Local clipboard capture remains the source of truth and never waits for network delivery.

## Completed in this branch

- ✅ Same-LAN discovery with the six-digit pairing code and an advertised TCP port.
- ✅ Text, link, email, and color item sync.
- ✅ Image and thumbnail byte transfer with a 512 KB safety cap.
- ✅ File byte transfer in 64 KiB chunks; files remain disabled by default.
- ✅ User-controlled file allowlist, blocklist, per-file size, and total queued-size limits.
- ✅ Receiver-side extension and size validation before any bytes are persisted.
- ✅ Remote files and images stored only under Clipmo-managed storage with sanitized names.
- ✅ Edit, favorite/pin, and delete propagation.
- ✅ Stable cross-device item IDs, Lamport/wall-clock/device deterministic last-write-wins resolution, tombstones, and self-origin loop prevention.
- ✅ Bounded newest-wins send queue so slow peers cannot block clipboard capture.
- ✅ Device badges and peer status remain visible in the existing Clipmo UI.
- ✅ Rust tests cover safe defaults, file filtering, conflict ordering, queue bounds, and path sanitization.
- ✅ Sync watcher paths follow the repository's strict Clippy policy without local lint exceptions.
- ✅ Quick-window startup retries transient history-load races before showing a persistent failure.
- ✅ The undecorated Quick Clipboard disables Tauri's Windows shadow and CI rejects any returned white outer frame.
- ✅ Windows package metadata identifies Jackson Kasi as publisher, with optional trusted Authenticode signing from repository certificate secrets.

## Defaults

- Text-like content: enabled.
- Images: enabled, maximum 512 KB including thumbnail.
- Files: disabled until explicitly enabled.
- File mode: blocklist.
- Per-file maximum: 25 MB.
- Total queued batch maximum: 100 MB.

## Remaining after the desktop release

- ⬜ Android and iOS clipboard integrations.
- ⬜ Replace the LAN PIN trust boundary with certificate-pinned mTLS.
- ⬜ Manual QA with two physical devices across Windows/macOS/Linux builds as those packages become available.
- ⬜ Add a trusted Windows code-signing certificate secret if the release workflow reports an unsigned build.

Verification runs from this branch so the exact reviewed commit produces the installer and screenshots. GitHub Actions must keep frontend tests/build, Rust formatting, Clippy with warnings denied, Rust tests, NSIS packaging, Authenticode verification, installed-app smoke tests, white-frame screenshot checks, and artifact upload green before merge.

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

GitHub Actions must keep frontend tests/build, Rust formatting, Clippy with warnings denied, Rust tests, NSIS packaging, installed-app smoke tests, and artifact screenshots green before merge.

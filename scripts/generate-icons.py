"""Generate the Clipmo icon set from the master logo.

Master sources (per the icon spec):
  - src-tauri/icons/logo.svg        - vector source of truth
  - src-tauri/icons/logo-source.png - raster export (any size; we upsample)

Pipeline:
  1. Load the raster source.
  2. Upscale to 1024x1024 with LANCZOS (clean vector-style design => excellent).
  3. Save 1024x1024 as icon.png.
  4. Resize to every size listed in the icon spec.
  5. Bundle a multi-resolution icon.ico (16, 32, 48, 64, 128, 256).
  6. Build a 620x300 SplashScreen.png with the logo centered on a brand
     background.

The script is idempotent: re-run it any time to regenerate the full set.
"""

from __future__ import annotations

import io
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw

# --- Paths ----------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
ICONS_DIR = REPO_ROOT / "src-tauri" / "icons"
ASSETS_DIR = REPO_ROOT / "assets"

SVG_MASTER = ICONS_DIR / "logo.svg"
PNG_MASTER = ICONS_DIR / "logo-source.png"

# --- Brand ----------------------------------------------------------------

# Brand blue sampled from the master SVG (#0073ED).
BRAND_BLUE = (0, 115, 237, 255)
# Off-white for splash foreground contrast.
SPLASH_FG = (255, 255, 255, 255)

# --- Asset spec -----------------------------------------------------------

# (filename, width, height, use)
SQUARE_TARGETS: list[tuple[str, int, int, str]] = [
    ("Square30x30Logo.png",   30,  30,  "Start menu tile"),
    ("Square44x44Logo.png",   44,  44,  "Start tile"),
    ("Square71x71Logo.png",   71,  71,  "Start tile"),
    ("Square89x89Logo.png",   89,  89,  "Start tile"),
    ("Square107x107Logo.png", 107, 107, "Start tile"),
    ("Square142x142Logo.png", 142, 142, "Start tile"),
    ("Square150x150Logo.png", 150, 150, "Start tile"),
    ("Square284x284Logo.png", 284, 284, "Start tile"),
    ("Square310x310Logo.png", 310, 310, "Start tile"),
    ("StoreLogo.png",         50,  50,  "Microsoft Store"),
]

# Tauri bundle targets (must match tauri.conf.json bundle.icon).
TAURI_TARGETS: list[tuple[str, int, int, str]] = [
    ("32x32.png",      32,  32,  "Taskbar small"),
    ("128x128.png",    128, 128, "App list, store"),
    ("128x128@2x.png", 256, 256, "HiDPI app"),
]

TRAY_TARGETS: list[tuple[str, int, int, str]] = [
    ("tray.png",   32, 32, "System tray"),
    ("tray@2x.png", 64, 64, "HiDPI tray"),
]

# Multi-resolution .ico entries (the 256 size fulfils Windows executable
# contract; smaller sizes give crisper rendering in legacy surfaces).
ICO_SIZES: list[int] = [16, 32, 48, 64, 128, 256]

SPLASH_W, SPLASH_H = 620, 300


# --- Pipeline -------------------------------------------------------------

def _load_master() -> Image.Image:
    """Load the raster master, falling back to the SVG via Pillow if needed."""
    if PNG_MASTER.exists():
        return Image.open(PNG_MASTER).convert("RGBA")

    if SVG_MASTER.exists():
        # Best-effort: Pillow does not render SVG, but we try via the
        # `cairosvg` shim if it's installed in the active environment.
        try:
            import cairosvg  # type: ignore

            with SVG_MASTER.open("rb") as fh:
                return Image.open(
                    io.BytesIO(cairosvg.svg2png(bytestring=fh.read()))
                ).convert("RGBA")
        except Exception as exc:  # noqa: BLE001
            sys.exit(
                f"Cannot render SVG without cairosvg and {PNG_MASTER} is "
                f"missing. Tried SVG: {SVG_MASTER} (error: {exc})"
            )

    sys.exit(f"No master source found. Expected {SVG_MASTER} or {PNG_MASTER}.")


def _build_master(master: Image.Image) -> Image.Image:
    """Upscale the raster source to 1024x1024 (the spec's master size)."""
    if master.size == (1024, 1024):
        return master
    return master.resize((1024, 1024), Image.Resampling.LANCZOS)


def _write_square(asset: Image.Image, out: Path, size: int) -> None:
    """Write a square asset, letterboxing the rounded logo onto a transparent
    canvas so the source geometry is preserved at small sizes."""
    if asset.size[0] == size and asset.size[1] == size:
        asset.save(out, format="PNG", optimize=True)
        return

    # Use a transparent canvas of the requested size and paste the source
    # centered at 1:1 (no rescale) so the logo keeps its proportions.
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # Down-then-up can soften the design; for non-1:1 sizes we simply
    # resize the asset to the requested box.
    fitted = asset.resize((size, size), Image.Resampling.LANCZOS)
    canvas.paste(fitted, (0, 0), fitted)
    canvas.save(out, format="PNG", optimize=True)


def _write_ico(asset: Image.Image, out: Path) -> None:
    """Write a multi-resolution icon.ico (16, 32, 48, 64, 128, 256).

    Pillow's high-level ICO save is unreliable across versions, so we
    hand-roll the ICONDIR + ICONDIRENTRY structure the same way the
    PowerShell generator does.
    """
    chunks: list[bytes] = []
    for s in ICO_SIZES:
        frame = asset.resize((s, s), Image.Resampling.LANCZOS)
        chunks.append(_png_bytes(frame))

    # ICONDIR header.
    header = struct.pack("<HHH", 0, 1, len(ICO_SIZES))  # reserved, type=icon, count
    dir_size = 6 + 16 * len(ICO_SIZES)
    offset = dir_size
    entries = b""
    for s, data in zip(ICO_SIZES, chunks):
        w = 0 if s >= 256 else s
        entries += struct.pack(
            "<BBBBHHII",
            w,                     # width (0 means 256)
            w,                     # height
            0,                     # color count
            0,                     # reserved
            1,                     # color planes
            32,                    # bits per pixel
            len(data),             # bitmap size
            offset,                # offset
        )
        offset += len(data)

    out.write_bytes(header + entries + b"".join(chunks))


def _png_bytes(img: Image.Image) -> bytes:
    """Serialize a Pillow image to PNG bytes in memory."""
    with io.BytesIO() as buf:
        img.save(buf, format="PNG")
        return buf.getvalue()


def _write_splash(asset: Image.Image, out: Path) -> None:
    """Build a 620x300 splash screen with the logo and wordmark centered on
    a brand-blue background."""
    bg = Image.new("RGBA", (SPLASH_W, SPLASH_H), BRAND_BLUE)

    # Lay out logo + wordmark as a single centered block so the
    # composition fits inside the 300px canvas with breathing room.
    try:
        from PIL import ImageFont

        font = ImageFont.truetype("arial.ttf", 40)
    except OSError:
        font = ImageFont.load_default()

    text = "Clipmo"
    draw = ImageDraw.Draw(bg)
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
    except AttributeError:
        text_w, text_h = draw.textsize(text, font=font)  # type: ignore[attr-defined]

    # Logo target: 160px tall, keeping the 1:1 master geometry.
    logo_h = 160
    logo_w = int(asset.size[0] * (logo_h / asset.size[1]))
    logo = asset.resize((logo_w, logo_h), Image.Resampling.LANCZOS)

    gap = 18
    block_h = logo_h + gap + text_h
    block_top = (SPLASH_H - block_h) // 2

    logo_x = (SPLASH_W - logo_w) // 2
    bg.paste(logo, (logo_x, block_top), logo)

    text_x = (SPLASH_W - text_w) // 2
    text_y = block_top + logo_h + gap
    draw.text((text_x, text_y), text, fill=SPLASH_FG, font=font)

    bg.save(out, format="PNG", optimize=True)


# --- Main -----------------------------------------------------------------

def main() -> int:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[icons] reading master from {PNG_MASTER}")
    raw = _load_master()
    print(f"[icons] raw size {raw.size}")

    master = _build_master(raw)
    print(f"[icons] master size {master.size}")

    icon_path = ICONS_DIR / "icon.png"
    master.save(icon_path, format="PNG", optimize=True)
    print(f"[icons] wrote {icon_path.relative_to(REPO_ROOT)} ({master.size[0]}x{master.size[1]})")

    for name, w, h, use in SQUARE_TARGETS + TAURI_TARGETS + TRAY_TARGETS:
        out = ICONS_DIR / name
        _write_square(master, out, max(w, h))
        print(f"[icons] wrote {out.relative_to(REPO_ROOT)} ({w}x{h} - {use})")

    ico_path = ICONS_DIR / "icon.ico"
    _write_ico(master, ico_path)
    print(f"[icons] wrote {ico_path.relative_to(REPO_ROOT)} (multi-res {ICO_SIZES})")

    splash_path = ICONS_DIR / "SplashScreen.png"
    _write_splash(master, splash_path)
    print(f"[icons] wrote {splash_path.relative_to(REPO_ROOT)} ({SPLASH_W}x{SPLASH_H})")

    # Drop a clean 256px version into assets/ for the README banner.
    readme_logo = ASSETS_DIR / "logo-256.png"
    master.resize((256, 256), Image.Resampling.LANCZOS).save(
        readme_logo, format="PNG", optimize=True
    )
    print(f"[icons] wrote {readme_logo.relative_to(REPO_ROOT)} (256x256 banner)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

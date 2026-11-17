# GLBRYX

**Capture • Preview • Convert — Blender-ready 3D exports**

GLBRYX is an independent Chrome / Edge Manifest V3 extension for inspecting locally captured Meshy 3D model data, previewing GLB geometry, and converting files for Blender.

## Features

- Captured model gallery with thumbnail previews and interactive 3D inspection
- Offline GLB conversion to OBJ, STL, PLY, glTF
- Default **Blender-ready GLB** export with `EXT_meshopt_compression` decoding and embedded WebP-to-PNG texture conversion
- Optional original GLB backup
- Local file import and conversion, no external conversion server

## Installation

1. Open this repo and download a source ZIP using **Code → Download ZIP**.
2. Extract it. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**, select **Load unpacked**, and choose the `extension` folder.
4. Open your model in Meshy, reload its page, then use the GLBRYX toolbar button.
5. For an existing compressed GLB, open the **Local 3D viewer & converter**, import the file, and save **GLB — Blender Ready**.

## Limitations

- Meshy viewer capture is **not independently verified** on a real Meshy Free account.
- Requires a complete valid GLB accessible in the browser; it cannot restore missing geometry, fix corrupted exports or decode proprietary .meshy files.
- Meshopt GLBs and embedded WebP are supported; Draco-compressed geometry is not decoded in this version.
- 3D geometry thumbnail is lightweight and does not offer a full textured PBR preview.
- Actual Blender import is not end-to-end verified.
- Keep model and texture rights in mind; GLBRYX is not affiliated with Meshy.

## Technical notes

Manifest V3; all GLB processing is local. Captured models are cached in origin-local IndexedDB.

Bundled Meshopt reference decoder is MIT-licensed, credited in `extension/LICENSE-MESHOPT.md`.

## Development

```bash
cd extension
node tests/test-glb.js
node tests/test-page-hook.js
node tests/test-decompress.js
node tests/test-webp.js
```

**Version:** 1.3.0

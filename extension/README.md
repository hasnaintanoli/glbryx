# GLBRYX v1.3 — 3D capture, preview & Blender-ready exports

**Chrome / Edge Manifest V3 extension.** For GLB models already captured by its Meshy viewer hook or GLB files you import locally, version 1.2 automatically uncompresses **`EXT_meshopt_compression`** geometry and converts embedded **WebP textures into PNG** before downloading a Blender-ready GLB. This runs entirely on your computer; there is no conversion API or model upload. The original compressed GLB can be saved as a separate backup.

## Features

- **Default GLB export = Blender-ready GLB.** Popup gallery / full 3D preview / local file converter all use the same code and output a file named `model.blender.glb` (popup) or `model_blender.glb` (local viewer).
- **Meshopt decoder included offline.** Handles `EXT_meshopt_compression` with attribute, triangle-index and index-sequence streams and associated codec filters. Removes Meshopt extension declarations and rebuilds the GLB binary chunk and buffer-view offsets.
- **Automatic WebP → PNG texture conversion** with the browser's built-in image decoder. Updates image bufferViews and texture references to preserve embedded materials and textures for Blender's importer.
- **Keeps model structure.** Scenes, nodes, geometry, normals, UVs, materials, textures, skins and animations are retained in GLB; unlike OBJ/STL/PLY geometry-only exports.
- **Download original GLB** remains an explicit option. Works if auto-decompression can't process a particular GLB.
- **Compression-aware previews** for captured model thumbnails and interactive geometry preview.

## Install / update

1. Download and extract the ZIP to a permanent directory.
2. Open `chrome://extensions` (Edge: `edge://extensions`) and enable **Developer mode**.
3. If version 1.1 is installed, use **Remove** first, to avoid competing Meshy hooks.
4. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
5. Open a model in your Meshy workspace and reload the Meshy page. Wait until its 3D viewer has loaded.
6. Open **GLBRYX** from the toolbar. Choose your captured model card. Click **View in 3D** if you want a preview. Leave **GLB · Blender Ready** selected (the default), then click **Save model**.
7. In Blender go to **File → Import → glTF 2.0 (.glb/.gltf)** and select the exported `.blender.glb`.

### Already saved a compressed GLB?

Open the extension and click **Local 3D viewer & converter**. Drop your `.glb` file into the page. The file will be decoded automatically. Click **GLB — Blender ready (auto)** to download it without compression. You do not need to recapture the model.

## How automatic decompression works

`js/meshopt_reference.js` provides an offline JavaScript implementation of the Meshopt codec. `js/glb.js` decodes the compressed bufferViews, creates new aligned buffer segments, removes the `EXT_meshopt_compression` references, optionally turns embedded WebP textures into PNG, repacks a valid GLB 2.0 file, and then hands the Blob to the Chrome download flow. No server upload and no Meshy API key.

The reference decoder trades performance for easier offline packaging; large files may take time and memory in Chrome. The popup can close during long conversions; for large local files, prefer the **Local 3D viewer & converter** tab.

## Compatibility and limitations

- This version supports **Meshopt-compressed GLB** and embedded WebP textures. It does **not** decode proprietary `.meshy` files or **Draco-compressed geometry**. A Draco file can still be saved with the **Original GLB** option and may be importable in a modern Blender version.
- Files with other unsupported required glTF extensions, invalid GLB headers or damaged binary chunks may still fail Blender import; compression is not the only cause of import errors.
- This is not a general FBX/BLEND/USDZ converter. OBJ/STL/PLY contain geometry only, without textures/rigging/animations.
- If the Meshy viewer does **not** expose a complete GLB to the browser page, no model will be captured. Successful capture on a real Meshy Free Plan account **has not been independently verified** here.
- The extension stores its captured models in the Meshy-origin IndexedDB (up to 12 models). Clearing website data removes the capture history. No account password or token is requested or exported.
- Thumbnail / on-page 3D preview displays geometry and flat material colors, not a textured PBR renderer. However, Blender-ready GLB preserves embedded texture information, converting WebP where needed.
- Chrome extension automation was blocked by the testing browser's policy. Real Meshy capture and actual Blender import have **not been end-to-end tested** in this environment. Conversion outputs were independently inspected with a glTF parser and `trimesh`.

## Testing

On a development machine:

```bash
node tests/test-glb.js
node tests/test-page-hook.js
node tests/test-decompress.js
node tests/test-webp.js
python tests/test-preview.py
python tests/test-webp-preview.py
python tests/test-popup.py
```

`tests/test-decompress.js` generates a synthetic **Meshopt-compressed cube GLB** and round-trips its geometry and index data to an ordinary GLB, testing v0/v1 attributes, indices and triangles. `tests/test-webp-preview.py` checks that WebP texture bytes are replaced by PNG and texture references remain valid. Demo files are stored in `sample/`.

`tests/test-browser.py` is an optional browser-extension end-to-end test; it may fail if Chrome blocks unpacked extension loading in headless mode.

## Files

- `manifest.json`, `page-hook.js`, `content.js` — extension entry and local model capture.
- `popup.html`, `popup.js`, `styles.css` — gallery, thumbnails, Blender-ready download selector.
- `viewer.html`, `viewer.js`, `viewer.css` — standalone file import and converter.
- `js/glb.js` — GLB parser, Meshopt/WebP decompression and geometry exports.
- `js/meshopt_reference.js` — bundled offline meshoptimizer reference decoder, MIT license; third-party notice in `LICENSE-MESHOPT.md`.
- `js/preview.js` — geometry thumbnail and interactive preview.

## Privacy

Model conversion happens locally in your browser. No conversion service, tracking script, account credential collection or background upload is included.

## GLBRYX on GitHub

This is an independent browser extension, not affiliated with Meshy. Use it only for 3D models you have rights to save and convert.

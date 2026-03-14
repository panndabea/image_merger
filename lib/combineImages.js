'use strict';

/**
 * @file combineImages.js
 * @description Core image-composition utility for silver-engine.
 *
 * ## How it works
 * All composition is done by the [sharp](https://sharp.pixelplumbing.com/)
 * library, which is a high-performance Node.js wrapper around libvips.
 *
 * The algorithm is intentionally simple:
 *
 * 1. **Decode metadata** — sharp reads just the image header to get each
 *    image's width and height without decompressing the full pixel data.
 * 2. **Calculate canvas size** — depending on the requested layout:
 *    - *horizontal*: canvas width = sum of all widths, height = tallest image.
 *    - *vertical*:   canvas width = widest image, height = sum of all heights.
 * 3. **Create blank canvas** — a white RGBA canvas of the calculated size.
 * 4. **Composite** — each source image is placed at its computed (top, left)
 *    offset via sharp's `.composite()` API.
 * 5. **Encode to PNG** — the result is serialised to a lossless PNG `Buffer`
 *    and returned to the caller.
 *
 * @module combineImages
 */

const sharp = require('sharp');

/**
 * Combine an array of images into a single PNG `Buffer`.
 *
 * Images are placed in the order they appear in the `inputs` array.
 * Images that are shorter (horizontal layout) or narrower (vertical layout)
 * than the canvas are placed at the top-left; the remaining space stays white.
 *
 * @param {Array<Buffer|string>} inputs
 *   Each element is either a raw image `Buffer` or an absolute file-system
 *   path to an image file.  Any format that libvips/sharp understands is
 *   accepted (JPEG, PNG, WEBP, AVIF, TIFF, GIF, …).  HEIC/HEIF files are
 *   converted to JPEG buffers upstream (see `lib/convertHeic.js`) before
 *   being passed here.
 *   Must contain at least one element; the caller is responsible for
 *   validating the minimum count (the server enforces ≥ 2).
 *
 * @param {'horizontal'|'vertical'} [layout='horizontal']
 *   Composition direction:
 *   - `'horizontal'` — images are placed side by side (left → right).
 *   - `'vertical'`   — images are stacked on top of each other (top → bottom).
 *   Any value other than `'vertical'` is treated as `'horizontal'`.
 *
 * @returns {Promise<Buffer>}
 *   Resolves with the combined image encoded as a lossless PNG `Buffer`.
 *
 * @throws {Error}
 *   Re-throws any error emitted by sharp (e.g. corrupt image data, invalid
 *   dimensions).
 *
 * @example
 * // Combine two JPEG files side by side (using file paths)
 * const { combineImages } = require('./lib/combineImages');
 * const png = await combineImages(['/tmp/left.jpg', '/tmp/right.jpg'], 'horizontal');
 * require('fs').writeFileSync('combined.png', png);
 */
async function combineImages(inputs, layout = 'horizontal') {
  // ── Step 1: Decode metadata ───────────────────────────────────────────────
  // Read only the image headers (width, height, format, etc.) without loading
  // the full pixel data into memory.  Sequential iteration keeps peak memory
  // low on constrained hardware (1/8 CPU, 0.5 GB RAM).
  const metas = [];
  for (const input of inputs) {
    metas.push(await sharp(input).metadata());
  }

  if (layout === 'vertical') {
    // ── Step 2 (vertical): Calculate canvas dimensions ──────────────────────
    // Canvas is as wide as the widest image and as tall as all images stacked.
    const width = Math.max(...metas.map((m) => m.width));
    const height = metas.reduce((sum, m) => sum + m.height, 0);

    // ── Step 3 (vertical): Build composite descriptor array ─────────────────
    // Each entry places one image at the next available vertical slot.
    const composites = [];
    let top = 0;
    for (let i = 0; i < inputs.length; i++) {
      composites.push({ input: inputs[i], top, left: 0 });
      top += metas[i].height;
    }

    // ── Step 4 & 5: Create canvas, composite, encode ────────────────────────
    return sharp({
      create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .composite(composites)
      .png()
      .toBuffer();
  }

  // ── Step 2 (horizontal): Calculate canvas dimensions ──────────────────────
  // Canvas is as tall as the tallest image and as wide as all images side-by-side.
  const width = metas.reduce((sum, m) => sum + m.width, 0);
  const height = Math.max(...metas.map((m) => m.height));

  // ── Step 3 (horizontal): Build composite descriptor array ─────────────────
  const composites = [];
  let left = 0;
  for (let i = 0; i < inputs.length; i++) {
    composites.push({ input: inputs[i], top: 0, left });
    left += metas[i].width;
  }

  // ── Step 4 & 5: Create canvas, composite, encode ──────────────────────────
  return sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

module.exports = { combineImages };

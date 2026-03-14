'use strict';

/**
 * @file convertHeic.js
 * @description Utility for converting HEIC/HEIF image buffers to JPEG.
 *
 * Apple devices (iPhone, iPad, Mac) capture photos in HEIC/HEIF format by
 * default.  libvips (and therefore sharp) does not include HEIF codec support
 * in its pre-built binaries on most deployment environments.  This module
 * provides a pure-JavaScript fallback using the `heic-convert` package, which
 * bundles libheif compiled to WebAssembly.
 *
 * The conversion is intentionally kept separate from the main
 * `combineImages` logic so it can be unit-tested in isolation and swapped out
 * independently if a native codec becomes available.
 *
 * @module convertHeic
 */

const heicConvert = require('heic-convert');

/**
 * Set of MIME types that identify HEIC/HEIF images (including multi-image
 * sequences such as Live Photos).
 *
 * @type {Set<string>}
 */
const HEIC_MIMETYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

/**
 * Convert a HEIC or HEIF image buffer to a JPEG buffer.
 *
 * Uses the `heic-convert` package (WebAssembly-based libheif) so no native
 * codec is required in the deployment environment.
 *
 * @param {Buffer} inputBuffer - Raw HEIC/HEIF file data as a Node.js Buffer.
 * @returns {Promise<Buffer>} Resolves with JPEG image data as a Node.js Buffer.
 * @throws {Error} Re-throws any error from `heic-convert` (e.g. the input is
 *   not valid HEIC/HEIF data).
 */
async function convertHeicToJpeg(inputBuffer) {
  const output = await heicConvert({
    buffer: inputBuffer,
    format: 'JPEG',
    quality: 0.92,
  });
  return Buffer.from(output);
}

module.exports = { HEIC_MIMETYPES, convertHeicToJpeg };

'use strict';

/**
 * @file convertHeic.js
 * @description Pure-JavaScript HEIC/HEIF → JPEG conversion utility.
 *
 * Apple devices save photos in the HEIC/HEIF container format.  The
 * server-side sharp/libvips build on Render's free tier is compiled without
 * the optional HEIF codec, so sharp cannot decode those files directly.
 *
 * This module works around that limitation by using `heic-convert`, a
 * WebAssembly-based pure-JavaScript HEIC decoder that requires no native
 * system libraries beyond what Node.js already ships.  The converted JPEG
 * buffer is then handed to sharp/combineImages like any other image.
 *
 * @module convertHeic
 */

const fs = require('node:fs/promises');
const heicConvert = require('heic-convert');

/** MIME types that identify HEIC/HEIF containers. */
const HEIC_MIMETYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

/**
 * Convert a HEIC/HEIF file to a JPEG `Buffer` using a pure-JavaScript decoder.
 *
 * If the MIME type is not HEIC/HEIF the function returns the original file
 * path unchanged so the caller can pass it straight to sharp without any
 * extra overhead.
 *
 * @param {string} filePath - Absolute path to the uploaded file on disk.
 * @param {string} mimetype - MIME type reported by the browser/client.
 * @returns {Promise<Buffer|string>}
 *   Resolves with a JPEG `Buffer` for HEIC/HEIF inputs, or the original
 *   `filePath` string for every other image type.
 * @throws {Error}
 *   Throws with a descriptive message when the file claims to be HEIC/HEIF
 *   but `heic-convert` cannot decode it (e.g. the bytes are corrupt or the
 *   client lied about the MIME type).
 */
async function maybeConvertHeic(filePath, mimetype) {
  if (!HEIC_MIMETYPES.has(mimetype)) {
    return filePath;
  }

  let inputBuffer;
  try {
    inputBuffer = await fs.readFile(filePath);
  } catch (err) {
    throw new Error(`Failed to read uploaded HEIC/HEIF file: ${err.message}`);
  }

  let outputArrayBuffer;
  try {
    outputArrayBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: 0.92,
    });
  } catch (err) {
    throw new Error(
      `Failed to decode HEIC/HEIF image. Ensure the file is a valid HEIC/HEIF image. (${err.message})`
    );
  }

  return Buffer.from(outputArrayBuffer);
}

module.exports = { maybeConvertHeic, HEIC_MIMETYPES };

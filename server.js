'use strict';

/**
 * @file server.js
 * @description Express HTTP server for silver-engine.
 *
 * ## Overview
 * This file is the single entry-point for the application.  It:
 *   1. Serves the static front-end (public/index.html).
 *   2. Exposes a `POST /combine` endpoint that accepts multiple uploaded image
 *      files, delegates the pixel-level work to `lib/combineImages`, and
 *      responds with a download-ready PNG.
 *
 * ## Key design decisions
 * - **Disk-based upload storage** — uploaded files are written to the OS temp
 *   directory (`os.tmpdir()`) by multer and deleted after each request.  This
 *   keeps large images (e.g. 10 MB) out of the Node.js heap, which is critical
 *   on the 0.5 GB Render free-tier.
 * - **Single libvips thread** — `sharp.concurrency(1)` limits the underlying
 *   libvips thread-pool to one thread, preventing CPU throttling on a 1/8 CPU
 *   allocation.
 * - **No libvips cache** — `sharp.cache(false)` disables the libvips operation
 *   cache so processed pixel data is not retained in RAM between requests.
 * - **Content-Disposition: attachment** — the response header tells browsers
 *   to treat the response as a file download, not an inline resource, making
 *   the download flow work even when the API endpoint is called directly.
 *
 * @module server
 */

const os = require('node:os');
const fs = require('node:fs');
const express = require('express');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');
const { combineImages } = require('./lib/combineImages');
const { HEIC_MIMETYPES, convertHeicToJpeg } = require('./lib/convertHeic');

// ── libvips / sharp resource limits ──────────────────────────────────────────
// Constrained Render free-tier environment: 1/8 CPU, 0.5 GB RAM.
// concurrency(1) — keep the libvips thread-pool at a single thread so the
//   process doesn't compete with itself on a fractional CPU allocation.
// cache(false)   — disable libvips's operation cache entirely; we process each
//   request once and discard the result, so caching only wastes RAM.
sharp.concurrency(1);
sharp.cache(false);

const app = express();

// ── Reverse-proxy trust ───────────────────────────────────────────────────────
// Render (and most PaaS providers) sit behind a load-balancer that appends the
// real client IP to the X-Forwarded-For header.  Telling Express to trust the
// first proxy hop lets express-rate-limit read the correct client IP and
// suppresses its ERR_ERL_UNEXPECTED_X_FORWARDED_FOR validation error.
app.set('trust proxy', 1);

// ── Rate limiter ──────────────────────────────────────────────────────────────
// Protect the combine endpoint against bursts that would exhaust the limited
// CPU and RAM on the Render free tier (1/8 CPU, 0.5 GB RAM).
// Allow up to 20 combine requests per IP per minute.
const combineLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * TCP port the HTTP server binds to.
 * Defaults to 3000 for local development; override via the `PORT` env-var
 * (Render sets this automatically).
 *
 * @type {number|string}
 */
const PORT = process.env.PORT || 3000;

/**
 * Multer middleware configured to write uploads to the OS temp directory
 * instead of holding them in Node.js heap memory.  Disk-based storage means
 * that large files (e.g. 10 MB images) are never resident in RAM while they
 * wait to be processed, which is critical on a 0.5 GB RAM host.
 *
 * Constraints applied here:
 * - `fileSize` — 10 MB per file; generous enough for typical use while
 *   preventing a single upload from exhausting the available RAM.
 * - `fileFilter` — rejects non-image MIME types early, before any bytes are
 *   written to disk, so the client receives a clear 400-level error.
 *
 * @type {import('multer').Multer}
 */
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter(_req, file, cb) {
    // HEIC/HEIF images (common on Apple devices) are accepted and converted
    // to JPEG automatically before combining.
    if (HEIC_MIMETYPES.has(file.mimetype) || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Serve the UI and any other static assets from the public/ directory.
app.use(express.static(path.join(__dirname, 'public')));

/**
 * POST /combine
 *
 * Accepts 2–20 image files via `multipart/form-data` (field name `images`),
 * combines them into a single PNG, and returns the result as a file download.
 * A maximum of 20 files keeps peak memory within the 0.5 GB RAM budget.
 *
 * ### Query parameters
 * | Name     | Values                    | Default      |
 * |----------|---------------------------|--------------|
 * | `layout` | `"horizontal"` \| `"vertical"` | `"horizontal"` |
 *
 * ### Request
 * `Content-Type: multipart/form-data`
 * Field `images` must appear at least twice (≥ 2 files required).
 *
 * ### Response — success (200)
 * ```
 * Content-Type: image/png
 * Content-Disposition: attachment; filename="combined.png"
 * <binary PNG data>
 * ```
 *
 * ### Response — client error (400)
 * ```json
 * { "error": "Please upload at least 2 images." }
 * ```
 *
 * ### Response — server error (500)
 * ```json
 * { "error": "Failed to combine images." }
 * ```
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
app.post('/combine', combineLimiter, upload.array('images', 20), async (req, res) => {
  // Collect temp-file paths so we can always delete them when we're done,
  // regardless of whether the request succeeds or fails.  Filter out any
  // entries that don't have a path (e.g. files rejected mid-stream).
  const tmpPaths = (req.files ?? []).map((f) => f.path).filter(Boolean);

  try {
    if (tmpPaths.length < 2) {
      return res.status(400).json({ error: 'Please upload at least 2 images.' });
    }

    // Build the inputs array for combineImages.  HEIC/HEIF files (common on
    // Apple devices) are transparently converted to JPEG buffers using a
    // WebAssembly-based codec so no native libheif build is required.
    // Non-HEIC files keep their temp-file path so large images are never fully
    // loaded into the Node.js heap unless they need conversion.
    const inputs = await Promise.all(
      req.files.map(async (file) => {
        if (!HEIC_MIMETYPES.has(file.mimetype)) {
          return file.path;
        }
        const heicBuf = await fs.promises.readFile(file.path);
        try {
          return await convertHeicToJpeg(heicBuf);
        } catch (convErr) {
          console.error(`HEIC/HEIF conversion failed for "${file.originalname}":`, convErr);
          const err = new Error(
            `Invalid or corrupted HEIC/HEIF file "${file.originalname}". ` +
            'Please ensure the file is a valid HEIC or HEIF image.'
          );
          err.isHeicError = true;
          throw err;
        }
      })
    );

    const layout = req.query.layout === 'vertical' ? 'vertical' : 'horizontal';
    const combined = await combineImages(inputs, layout);

    // Tell the browser this is a downloadable file, not an inline resource.
    // The front-end also uses a blob URL + the HTML `download` attribute for
    // the same effect, but this header ensures direct API callers also receive
    // a download prompt.
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'attachment; filename="combined.png"');
    res.send(combined);
  } catch (err) {
    if (err.isHeicError) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Error combining images:', err);
    res.status(500).json({ error: 'Failed to combine images.' });
  } finally {
    // Remove every temp file written by multer, whether the request succeeded,
    // failed, or was rejected early.  ENOENT is silently ignored (the file was
    // already cleaned up or was never written); any other error is logged.
    for (const p of tmpPaths) {
      fs.unlink(p, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error(`Failed to delete temp file ${p}:`, err);
        }
      });
    }
  }
});

// ── Multer / file-filter error handler ───────────────────────────────────────
// When multer's fileFilter calls cb(new Error(...)), Express receives a
// four-argument error-handling middleware call.  We surface that as a 400 so
// the client gets a meaningful message instead of a generic 500.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  return res.status(400).json({ error: err.message });
});

// Start listening only when this file is run directly (not when it is
// required by tests).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`silver-engine listening on port ${PORT}`);
  });
}

// Export the Express app so integration tests can mount it without binding a
// real TCP port.
module.exports = app;

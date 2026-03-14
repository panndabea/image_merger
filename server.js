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
 * - **In-memory storage** — uploaded files are kept in RAM via
 *   `multer.memoryStorage()` and never written to disk.  This keeps the
 *   server stateless and Render-friendly.
 * - **Content-Disposition: attachment** — the response header tells browsers
 *   to treat the response as a file download, not an inline resource, making
 *   the download flow work even when the API endpoint is called directly.
 *
 * @module server
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const { combineImages } = require('./lib/combineImages');

const app = express();

/**
 * TCP port the HTTP server binds to.
 * Defaults to 3000 for local development; override via the `PORT` env-var
 * (Render sets this automatically).
 *
 * @type {number|string}
 */
const PORT = process.env.PORT || 3000;

/**
 * Multer middleware configured for **in-memory** multipart/form-data parsing.
 *
 * Constraints applied here:
 * - `fileSize` — 20 MB per file to prevent memory exhaustion.
 * - `fileFilter` — rejects non-image MIME types early, before the buffer is
 *   even allocated, so the client receives a clear 400-level error.
 *
 * @type {import('multer').Multer}
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
  fileFilter(_req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
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
 * Accepts 2–50 image files via `multipart/form-data` (field name `images`),
 * combines them into a single PNG, and returns the result as a file download.
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
app.post('/combine', upload.array('images', 50), async (req, res) => {
  const files = req.files;

  if (!files || files.length < 2) {
    return res.status(400).json({ error: 'Please upload at least 2 images.' });
  }

  try {
    const layout = req.query.layout === 'vertical' ? 'vertical' : 'horizontal';
    const combined = await combineImages(files.map((f) => f.buffer), layout);

    // Tell the browser this is a downloadable file, not an inline resource.
    // The front-end also uses a blob URL + the HTML `download` attribute for
    // the same effect, but this header ensures direct API callers also receive
    // a download prompt.
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'attachment; filename="combined.png"');
    res.send(combined);
  } catch (err) {
    console.error('Error combining images:', err);
    res.status(500).json({ error: 'Failed to combine images.' });
  }
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

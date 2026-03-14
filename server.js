'use strict';

/**
 * @file server.js
 * @description Minimal static-file server for the Image Combiner front-end.
 *
 * All image processing is performed client-side in the browser using the
 * Canvas API — no files are uploaded to this server.
 *
 * @module server
 */

const express = require('express');
const path = require('path');

const app = express();

/**
 * TCP port the HTTP server binds to.
 * Defaults to 3000 for local development; override via the `PORT` env-var.
 *
 * @type {number|string}
 */
const PORT = process.env.PORT || 3000;

// Serve the UI and any other static assets from the public/ directory.
app.use(express.static(path.join(__dirname, 'public')));

// Start listening only when this file is run directly (not when it is
// required by tests).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`silver-engine listening on port ${PORT}`);
  });
}

// Export the Express app so tests can mount it without binding a real TCP port.
module.exports = app;

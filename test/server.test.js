'use strict';

/**
 * @file server.test.js
 * @description Integration tests for the static-file Express server (server.js).
 *
 * All image processing is now done client-side in the browser via the Canvas
 * API — the server only serves static assets.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../server');

// ─── Test lifecycle ───────────────────────────────────────────────────────────

/** @type {http.Server} */
let server;

/** @type {string} Base URL for all requests, e.g. `http://127.0.0.1:54321` */
let baseUrl;

before(
  () =>
    new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    })
);

after(
  () =>
    new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    })
);

// ─── Tests ────────────────────────────────────────────────────────────────────

test('GET / serves the HTML front-end', (_, done) => {
  http.get(`${baseUrl}/`, (res) => {
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] ?? '', /text\/html/);
    res.resume();
    res.on('end', done);
  }).on('error', done);
});

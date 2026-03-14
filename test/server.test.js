'use strict';

/**
 * @file server.test.js
 * @description Integration tests for the Express HTTP server (server.js).
 *
 * These tests spin up the Express app **without** binding a real TCP port by
 * using Node's built-in `http.createServer` + `net` to find a free port, or
 * simply by using supertest-style manual request helpers.  We opt for the
 * lightweight approach of importing the exported `app` and calling
 * `app.listen(0)` so the OS assigns an ephemeral port.
 *
 * ### What is tested here
 * - `POST /combine` returns `200` with the correct `Content-Type` and
 *   `Content-Disposition` headers so that browsers trigger a file download.
 * - `POST /combine` returns `400` when fewer than 2 images are supplied.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const sharp = require('sharp');
const app = require('../server');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a small solid-colour PNG `Buffer`.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} r - Red channel (0–255).
 * @param {number} g - Green channel (0–255).
 * @param {number} b - Blue channel (0–255).
 * @returns {Promise<Buffer>}
 */
async function solidPng(width, height, r, g, b) {
  return sharp({
    create: { width, height, channels: 4, background: { r, g, b, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

/**
 * Sends a `multipart/form-data` POST request to the running test server and
 * returns the raw `http.IncomingMessage` (response) along with the collected
 * body `Buffer`.
 *
 * This is a minimal, dependency-free alternative to supertest.
 *
 * @param {string}   url      - Full URL including host, port and path.
 * @param {Buffer[]} imgBufs  - Image buffers to attach as `images` fields.
 * @param {string}   [layout] - `'horizontal'` (default) or `'vertical'`.
 * @returns {Promise<{ res: http.IncomingMessage, body: Buffer }>}
 */
function postImages(url, imgBufs, layout = 'horizontal') {
  return new Promise((resolve, reject) => {
    const boundary = '----TestBoundary' + Date.now();

    // Build the multipart body manually.
    const parts = imgBufs.map((buf, i) => {
      const header = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="images"; filename="img${i}.png"\r\n` +
        `Content-Type: image/png\r\n\r\n`
      );
      const footer = Buffer.from('\r\n');
      return Buffer.concat([header, buf, footer]);
    });
    const closing = Buffer.from(`--${boundary}--\r\n`);
    const bodyBuf = Buffer.concat([...parts, closing]);

    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port:     parsedUrl.port,
      path:     `${parsedUrl.pathname}?layout=${layout}`,
      method:   'POST',
      headers: {
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuf.length,
      },
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ res, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

/**
 * Like `postImages`, but lets the caller specify a custom MIME type and
 * filename for each part.  Used to test file-filter rejection paths.
 *
 * @param {string} url
 * @param {{ buf: Buffer, mimetype: string, filename: string }[]} files
 * @returns {Promise<{ res: http.IncomingMessage, body: Buffer }>}
 */
function postImagesWithMimetype(url, files) {
  return new Promise((resolve, reject) => {
    const boundary = '----TestBoundaryMime' + Date.now();

    const parts = files.map(({ buf, mimetype, filename }) => {
      const header = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="images"; filename="${filename}"\r\n` +
        `Content-Type: ${mimetype}\r\n\r\n`
      );
      const footer = Buffer.from('\r\n');
      return Buffer.concat([header, buf, footer]);
    });
    const closing = Buffer.from(`--${boundary}--\r\n`);
    const bodyBuf = Buffer.concat([...parts, closing]);

    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port:     parsedUrl.port,
      path:     parsedUrl.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuf.length,
      },
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ res, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

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

test('POST /combine responds 200 with correct Content-Type and Content-Disposition', async () => {
  const a = await solidPng(20, 20, 255, 0, 0);
  const b = await solidPng(20, 20, 0, 0, 255);

  const { res, body } = await postImages(`${baseUrl}/combine`, [a, b]);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.match(
    res.headers['content-disposition'] ?? '',
    /attachment/,
    'Content-Disposition should contain "attachment" to trigger a browser download'
  );
  assert.match(
    res.headers['content-disposition'] ?? '',
    /combined\.png/,
    'Content-Disposition should suggest "combined.png" as the filename'
  );

  // Sanity-check that the body is actually a valid PNG.
  const meta = await sharp(body).metadata();
  assert.equal(meta.format, 'png');
});

test('POST /combine responds 400 when fewer than 2 images are provided', async () => {
  const a = await solidPng(20, 20, 255, 0, 0);

  const { res, body } = await postImages(`${baseUrl}/combine`, [a]);

  assert.equal(res.statusCode, 400);
  const json = JSON.parse(body.toString());
  assert.ok(typeof json.error === 'string', 'Response body should include an error message');
});

test('POST /combine vertical layout returns correct dimensions', async () => {
  const a = await solidPng(30, 10, 0, 255, 0);
  const b = await solidPng(30, 20, 0, 0, 255);

  const { res, body } = await postImages(`${baseUrl}/combine`, [a, b], 'vertical');

  assert.equal(res.statusCode, 200);
  const meta = await sharp(body).metadata();
  assert.equal(meta.width, 30);
  assert.equal(meta.height, 30);
});

test('POST /combine returns 400 for invalid/corrupt HEIC data', async () => {
  // Send garbage bytes labelled as HEIC.  The server accepts the MIME type,
  // attempts HEIC→JPEG conversion with heic-convert, and returns 400 when
  // the bytes cannot be decoded as a valid HEIC container.
  const fakeHeicBuf = Buffer.from('not-real-heic-data');

  const { res, body } = await postImagesWithMimetype(`${baseUrl}/combine`, [
    { buf: fakeHeicBuf, mimetype: 'image/heic', filename: 'photo.heic' },
    { buf: fakeHeicBuf, mimetype: 'image/heic', filename: 'photo2.heic' },
  ]);

  assert.equal(res.statusCode, 400);
  const json = JSON.parse(body.toString());
  assert.ok(
    typeof json.error === 'string' && json.error.toLowerCase().includes('heic'),
    'Error message should mention HEIC'
  );
});

test('POST /combine returns 400 for invalid/corrupt HEIF data', async () => {
  const fakeHeifBuf = Buffer.from('not-real-heif-data');

  const { res, body } = await postImagesWithMimetype(`${baseUrl}/combine`, [
    { buf: fakeHeifBuf, mimetype: 'image/heif', filename: 'photo.heif' },
    { buf: fakeHeifBuf, mimetype: 'image/heif', filename: 'photo2.heif' },
  ]);

  assert.equal(res.statusCode, 400);
  const json = JSON.parse(body.toString());
  assert.ok(
    typeof json.error === 'string' && json.error.toLowerCase().includes('heif'),
    'Error message should mention HEIF'
  );
});

test('POST /combine rejects non-image files with 400', async () => {
  const textBuf = Buffer.from('hello world');

  const { res, body } = await postImagesWithMimetype(`${baseUrl}/combine`, [
    { buf: textBuf, mimetype: 'text/plain', filename: 'notes.txt' },
    { buf: textBuf, mimetype: 'text/plain', filename: 'notes2.txt' },
  ]);

  assert.equal(res.statusCode, 400);
  const json = JSON.parse(body.toString());
  assert.ok(typeof json.error === 'string', 'Response body should include an error message');
});

# silver-engine

> **Upload multiple images → get one combined PNG back — instantly, in your browser.**

silver-engine is a small Node.js web application powered by [Express](https://expressjs.com/) and [sharp](https://sharp.pixelplumbing.com/).  
Users pick any number of images through a drag-and-drop UI, choose a layout (horizontal or vertical), and receive a lossless PNG they can preview and **download** with one click.

---

## Table of Contents

1. [Features](#features)  
2. [Quick Start](#quick-start)  
3. [Using the App](#using-the-app)  
4. [API Reference](#api-reference)  
5. [Project Structure](#project-structure)  
6. [Architecture & Design Decisions](#architecture--design-decisions)  
7. [Configuration](#configuration)  
8. [Running Tests](#running-tests)  
9. [Deployment (Render)](#deployment-render)  
10. [Contributing](#contributing)  
11. [Technology Stack](#technology-stack)  

---

## Features

| Feature | Details |
|---------|---------|
| **Multi-image upload** | Drag & drop or click to select — up to 50 images, 20 MB each |
| **Two layouts** | Horizontal (side-by-side) or vertical (stacked) |
| **Live preview** | Thumbnails appear immediately; individual images can be removed before combining |
| **One-click download** | After combining, a **Download combined.png** button saves the result locally |
| **Server-side composition** | Uses libvips via sharp — fast even for large images |
| **Stateless** | No files are ever written to disk; uploads live only in RAM for the duration of the request |
| **Zero client-side dependencies** | The front-end is plain HTML + CSS + vanilla JS |

---

## Quick Start

**Prerequisites:** [Node.js](https://nodejs.org/) ≥ 18

```bash
# 1. Clone the repo
git clone https://github.com/panndabea/silver-engine.git
cd silver-engine

# 2. Install dependencies
npm install

# 3. Start the development server
npm start
```

Open **http://localhost:3000** in your browser.

---

## Using the App

1. **Select images** — click the upload area or drag files onto it.  
   Supported formats: PNG, JPEG, WEBP, AVIF, TIFF, GIF (anything libvips understands), and **HEIC/HEIF** (Apple device photos — converted automatically on the server).
2. **Remove unwanted images** — click the **✕** button on a thumbnail.
3. **Choose a layout**:
   - *Horizontal* — images placed side-by-side, left to right.
   - *Vertical* — images stacked top to bottom.
4. **Click "Combine Images"** — the server processes the files and returns the combined PNG.
5. **Preview & download** — the result appears below the card. Click **⬇ Download combined.png** to save the file.

---

## API Reference

### `POST /combine`

Combines uploaded images into a single PNG and returns it as a file download.

#### Request

| Part | Value |
|------|-------|
| Method | `POST` |
| Content-Type | `multipart/form-data` |
| Field name | `images` (repeat for each file) |
| Minimum files | 2 |
| Maximum files | 50 |
| Maximum file size | 20 MB per file |

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `layout` | `"horizontal"` \| `"vertical"` | `"horizontal"` | Composition direction |

#### Responses

**200 OK** — Combined PNG returned as a download.

```
Content-Type: image/png
Content-Disposition: attachment; filename="combined.png"
<binary PNG data>
```

**400 Bad Request** — Fewer than 2 images supplied.

```json
{ "error": "Please upload at least 2 images." }
```

**500 Internal Server Error** — Unexpected processing failure.

```json
{ "error": "Failed to combine images." }
```

#### Example — cURL

```bash
curl -X POST "http://localhost:3000/combine?layout=horizontal" \
  -F "images=@photo1.jpg" \
  -F "images=@photo2.jpg" \
  --output combined.png
```

#### Example — JavaScript (Fetch API)

```js
const formData = new FormData();
formData.append('images', file1);
formData.append('images', file2);

const response = await fetch('/combine?layout=vertical', {
  method: 'POST',
  body: formData,
});

if (!response.ok) {
  const { error } = await response.json();
  throw new Error(error);
}

// Save the PNG
const blob = await response.blob();
const url  = URL.createObjectURL(blob);
const a    = document.createElement('a');
a.href     = url;
a.download = 'combined.png';
a.click();
```

---

## Project Structure

```
silver-engine/
├── lib/
│   └── combineImages.js   # Core image-composition logic (sharp wrapper)
├── public/
│   └── index.html         # Single-page front-end (HTML + CSS + vanilla JS)
├── test/
│   ├── combine.test.js    # Unit tests for combineImages()
│   └── server.test.js     # Integration tests for the HTTP server
├── server.js              # Express app entry-point
├── package.json
├── render.yaml            # Render.com deployment manifest
└── README.md
```

### Module responsibilities

| File | Responsibility |
|------|---------------|
| `server.js` | HTTP layer — routing, file parsing (multer), error handling, starting the server |
| `lib/combineImages.js` | Pure image-processing function; knows nothing about HTTP |
| `public/index.html` | Complete browser UI; communicates with the server via Fetch API |
| `test/combine.test.js` | Unit tests — verify pixel dimensions of the combined output |
| `test/server.test.js` | Integration tests — verify HTTP status codes, headers (including `Content-Disposition`) |

---

## Architecture & Design Decisions

### Why in-memory uploads?

`multer` is configured with `memoryStorage()`.  Files are held in RAM only for the duration of a single request.  This means:

- No temporary files to clean up.
- No persistent storage required on the host.
- Compatible with ephemeral file-systems like Render's free tier.

The trade-off is that very large batches of large images will consume more RAM.  The 20 MB per-file and 50-file limits keep this bounded.

### Why `Content-Disposition: attachment`?

Without this header, navigating directly to `/combine` in a browser would display the PNG inline.  Setting `Content-Disposition: attachment; filename="combined.png"` ensures the browser always treats the response as a file download.  The front-end also sets a blob URL + HTML `download` attribute for the same reason — both mechanisms reinforce each other.

### Why is `server.js` exportable?

`server.js` calls `app.listen()` only when it is run directly (`require.main === module`).  When required by tests, the app is exported without binding a port.  Integration tests can then call `app.listen(0)` to let the OS assign an ephemeral port, run assertions, and close the server cleanly — no port collisions, no test isolation issues.

### Why no front-end framework?

The UI has no significant state-management complexity, no routing, and no component tree.  A framework would add build tooling, bundle steps, and dependencies without meaningfully improving the experience.  Plain HTML + CSS + JS is readable, debuggable without dev-tools extensions, and loads in milliseconds.

### Blob URL lifecycle management

Each time the user combines a new set of images, the previous blob URL is revoked with `URL.revokeObjectURL()` before a new one is created.  Without this, every combine operation would permanently allocate memory that is never freed until the tab closes.

---

## Configuration

| Environment variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | TCP port the server listens on. Set automatically by Render. |
| `NODE_ENV` | *(unset)* | Set to `production` by Render; not used by application logic directly but may affect express internals. |

---

## Running Tests

```bash
npm test
```

This runs all `*.test.js` files under `test/` using Node's built-in test runner (available since Node 18 — no extra packages needed).

### Test coverage areas

| Test file | What it covers |
|-----------|---------------|
| `test/combine.test.js` | Horizontal layout dimensions, vertical layout dimensions, height-is-max rule, three-image combination |
| `test/server.test.js` | `Content-Disposition: attachment` header, `Content-Type: image/png`, 400 on < 2 images, correct pixel dimensions through the full HTTP stack |

---

## Deployment (Render)

The `render.yaml` file at the project root is a [Render Blueprint](https://render.com/docs/blueprint-spec).  To deploy:

1. Push this repository to GitHub.
2. Create a new **Web Service** on [render.com](https://render.com), connecting it to the repo.
3. Render will detect `render.yaml` and configure the service automatically.

```yaml
# render.yaml (summary)
services:
  - type: web
    name: silver-engine
    runtime: node
    buildCommand: npm install
    startCommand: node server.js
    envVars:
      - key: NODE_ENV
        value: production
```

Render sets the `PORT` environment variable; `server.js` reads it automatically.

---

## Contributing

1. **Fork** the repository and create a feature branch.
2. Make your changes, ensuring `npm test` passes.
3. Keep pull requests focused — one concern per PR.
4. Write or update tests for any changed behaviour.

### Coding conventions

- `'use strict'` at the top of every `.js` file.
- JSDoc on every exported function and non-trivial internal function.
- Inline comments explain *why*, not *what*.
- No third-party testing libraries — use `node:test` + `node:assert/strict`.

---

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | [Node.js](https://nodejs.org/) | ≥ 18 |
| HTTP framework | [Express](https://expressjs.com/) | ^5 |
| File upload middleware | [multer](https://github.com/expressjs/multer) | ^2 |
| Image processing | [sharp](https://sharp.pixelplumbing.com/) (libvips) | ^0.34 |
| Testing | `node:test` + `node:assert/strict` | built-in |
| Deployment | [Render](https://render.com/) | — |

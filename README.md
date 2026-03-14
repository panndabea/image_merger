# silver-engine

> **Upload multiple images → get one combined PNG back — instantly, in your browser.**

silver-engine is a **pure static web app** — no server, no build step, no Node.js.  
Users pick any number of images through a drag-and-drop UI, choose a layout (horizontal or vertical), and receive a lossless PNG they can preview and **download** with one click.  
All image processing happens locally in the browser using the built-in [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API) — your files are never uploaded anywhere.

---

## Table of Contents

1. [Features](#features)  
2. [Quick Start](#quick-start)  
3. [Using the App](#using-the-app)  
4. [Project Structure](#project-structure)  
5. [Architecture & Design Decisions](#architecture--design-decisions)  
6. [Deployment](#deployment)  
7. [Contributing](#contributing)  
8. [Technology Stack](#technology-stack)  

---

## Features

| Feature | Details |
|---------|---------|
| **Multi-image upload** | Drag & drop or click to select — any number of images |
| **Two layouts** | Horizontal (side-by-side) or vertical (stacked) |
| **Live preview** | Thumbnails appear immediately; individual images can be removed before combining |
| **One-click download** | After combining, a **Download combined.png** button saves the result locally |
| **100 % client-side** | Uses the Canvas API — no server, no uploads, no Node.js |
| **Zero dependencies** | Plain HTML + CSS + vanilla JS — open the file and it works |

---

## Quick Start

No installation required.

**Option A — open directly in your browser:**

```
public/index.html
```

Double-click `public/index.html` (or drag it into your browser) and the app is ready to use.

**Option B — serve locally with any static HTTP server:**

```bash
# Python (built-in)
python3 -m http.server 3000 --directory public

# Node.js (npx, no install)
npx serve public
```

Then open **http://localhost:3000** in your browser.

---

## Using the App

1. **Select images** — click the upload area or drag files onto it.  
   Supported formats: any image type your browser supports (PNG, JPEG, WEBP, AVIF, GIF, …).
2. **Remove unwanted images** — click the **✕** button on a thumbnail.
3. **Choose a layout**:
   - *Horizontal* — images placed side-by-side, left to right.
   - *Vertical* — images stacked top to bottom.
4. **Click "Combine Images"** — your browser composites the images on a `<canvas>` element.
5. **Preview & download** — the result appears below the card. Click **⬇ Download combined.png** to save the file.

---

## Project Structure

```
silver-engine/
├── public/
│   └── index.html   # The entire app — HTML + CSS + vanilla JS in one file
├── render.yaml      # Render.com static-site deployment manifest
└── README.md
```

---

## Architecture & Design Decisions

### Why client-side only?

All image composition is performed with the browser's native Canvas API:

1. Each selected `File` is decoded into an `HTMLImageElement` via an object URL.
2. A `<canvas>` is sized to fit all images in the chosen layout.
3. Each image is drawn with `ctx.drawImage()`.
4. `canvas.toBlob('image/png')` exports the result as a downloadable PNG.

This means:
- **No server required** — the app works offline, from `file://`, or from any CDN.
- **Privacy** — images never leave the user's device.
- **Zero latency** — no upload/download round-trip.

### Blob URL lifecycle management

Each time the user combines a new set of images, the previous blob URL is revoked with `URL.revokeObjectURL()` before a new one is created.  Without this, every combine operation would permanently allocate memory that is never freed until the tab closes.

---

## Deployment

Because the app is a single static HTML file, it can be hosted anywhere:

| Platform | How |
|----------|-----|
| **GitHub Pages** | Push to a repo → enable Pages → point to the `public/` folder (or root) |
| **Netlify / Vercel** | Connect repo → set publish directory to `public` |
| **Render** | `render.yaml` is already configured for static hosting |
| **Any CDN** | Upload `public/index.html` |

### Render

The `render.yaml` at the project root is a [Render Blueprint](https://render.com/docs/blueprint-spec):

```yaml
services:
  - type: web
    name: silver-engine
    runtime: static
    staticPublishPath: public
```

To deploy: push to GitHub, create a new **Static Site** on [render.com](https://render.com), and connect the repo — no build command needed.

---

## Contributing

1. **Fork** the repository and create a feature branch.
2. Open `public/index.html` in your browser to test changes directly.
3. Keep pull requests focused — one concern per PR.

### Coding conventions

- No build tools, no bundlers, no frameworks — keep it a single self-contained HTML file.
- JSDoc on every non-trivial function.
- Inline comments explain *why*, not *what*.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| UI | Plain HTML5 + CSS3 |
| Logic | Vanilla JavaScript (ES2020+) |
| Image processing | [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API) (built into every modern browser) |
| Deployment | [Render](https://render.com/) static hosting |


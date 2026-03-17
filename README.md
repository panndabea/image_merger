# zaladuplo

> **Upload multiple images → get one combined PNG back — instantly, in your browser.**

zaladuplo is a **pure static web app** — no server, no build step, no Node.js.  
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
zaladuplo/
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

### Two-pass streaming — how we keep RAM low

Imagine you have 10 big LEGO bricks to glue into one row. You have two choices:

**Old way (lots of space):** Take all 10 bricks out of the box at the same time, lay them side by side on the floor, *then* measure how long the row will be, *then* glue them together. While you are measuring, all 10 bricks are taking up floor space at once.

**New way (tiny footprint):** First, go through the box one brick at a time, write down each brick's size, then put it straight back. Now you know the total size, so you cut the exact right length of base plate. Then go through the box again, take one brick out, glue it on, put it back before picking up the next. At any moment only **one brick is ever out of the box**.

That is exactly what the combiner now does, in two passes:

1. **Measure pass** — for every image file, decode it into a bitmap just long enough to read its `width` and `height`, then immediately call `bitmap.close()` to free that memory before touching the next file.
2. **Draw pass** — now that the exact canvas size is known, create the output canvas, then loop through the files again: decode one bitmap, paint it at the right position, `bitmap.close()` right away, move to the next.

Because no decoded image is ever held longer than a single iteration, peak RAM is roughly **canvas pixels × 4 bytes + one image's pixels × 4 bytes** instead of **canvas + every image simultaneously**. For ten 4K photos that is the difference between needing ~1 GB and needing only ~200 MB.

### C-inspired memory and speed techniques

Several patterns borrowed from low-level C programming are applied throughout the worker:

#### Packed typed-array dimensions (avoid heap-object churn)

Instead of allocating an array of `{width, height}` JavaScript objects in the measure pass, image dimensions are stored in a flat `Int32Array` — a contiguous block of raw integers exactly like a C `int[]`.  This eliminates the per-element object header overhead and keeps the data cache-friendly.

#### `willReadFrequently: false` — halve canvas backing-store RAM

Every `OffscreenCanvas.getContext("2d")` call now passes `{ willReadFrequently: false }`.  This signals to the browser that pixels will **never** be read back by JavaScript (only forwarded to `convertToBlob` for encoding), so the implementation is free to keep the raster exclusively in GPU memory rather than maintaining a second CPU-accessible shadow copy.  For a 4 K × 4 K output canvas that saves ~64 MB of RAM.

#### C memory-pool pattern — one canvas per resolution level

When generating "Smallest" download candidates at reduced resolutions (0.9 ×, 0.8 ×), the previous code created a **new** `OffscreenCanvas` for every format × quality combination — up to six identical-sized canvases alive at the same time.  The new code allocates a **single pooled canvas per scale level**, encodes all format and quality variants from it, then explicitly frees it (`pool.width = 1; pool.height = 1; pool = null`) before moving to the next scale.  Peak allocation is now `output canvas + 1 pool canvas` instead of `output canvas + N pool canvases`.

#### Parallel encoding via `Promise.all`

PNG and WebP are encoded **concurrently** instead of sequentially using `Promise.all([canvas.convertToBlob(…), canvas.convertToBlob(…)])`.  Likewise, all format × quality variants within each scale group are dispatched to the browser's codec pipeline in parallel.  Both encodings read from the same immutable pixel buffer so there is no data hazard — this is equivalent to issuing multiple concurrent `read(2)` calls on a file descriptor in C.  On a modern multi-core device this alone can halve the total encoding time.

#### Explicit resource release (C-style `free`)

Every temporary `OffscreenCanvas` is zeroed (`width = 1, height = 1`) the moment it is no longer needed, releasing the GPU raster memory immediately rather than waiting for the garbage collector.  The same principle applies to `ImageBitmap.close()` after each draw call in the streaming passes.

### Blob URL lifecycle management

Each time the user combines a new set of images, the previous blob URL is revoked with `URL.revokeObjectURL()` before a new one is created.  Without this, every combine operation would permanently allocate memory that is never freed until the tab closes.

### 42-image benchmark (21 approaches) + selected implementation

To investigate the Safari slowdown and Firefox failure around large batches, I benchmarked **21 strategy variants** using a synthetic **42-image** workload (mixed widths/heights, horizontal combine, full encode path with PNG + lossy candidates).  
Measured in browser with `OffscreenCanvas` and `convertToBlob` (3 runs per approach, average shown).

Scoring:
- **avg ms** = lower is faster.
- **memory score** = lower means fewer concurrent encodes + fewer temporary canvases (proxy for peak pressure).

| Approach | Core idea | Avg time (ms) | Memory score |
|---|---|---:|---:|
| A01 | Object dims + for + parallel6 + scales 1/0.9 | 766.7 | 8 |
| A02 | Typed dims + for + parallel6 + scales 1/0.9 | 727.1 | 8 |
| A03 | Typed dims + while + parallel6 + scales 1/0.9 | 721.7 | 8 |
| A04 | Typed dims + for + serial6 + scales 1/0.9 | 1550.0 | 3 |
| A05 | Typed dims + for + parallel4 + scales 1/0.9 | 666.8 | 6 |
| A06 | Typed dims + for + serial4 + scales 1/0.9 | 1056.7 | 3 |
| A07 | Typed dims + for + serial4 + scale 1 | 589.7 | 2 |
| A08 | Typed dims + for + parallel2 + scale 1 | **273.9** | 3 |
| A09 | Typed dims + for + serial2 + scale 1 | 298.4 | **2** |
| A10 | Object dims + while + serial4 + scale 1 | 574.1 | 2 |
| A11 | Typed dims + for + parallel4 + scale 1 | 307.9 | 5 |
| A12 | Typed dims + while + serial4 + scale 1 | 575.8 | 2 |
| A13 | Typed dims + for + parallel6 + scale 1 | 411.0 | 7 |
| A14 | Typed dims + for + serial6 + scale 1 | 851.9 | 2 |
| A15 | Object dims + for + serial2 + scale 1 | 307.9 | 2 |
| A16 | Typed dims + for + serial4 + scales 1/0.85 | 998.7 | 3 |
| A17 | Typed dims + for + parallel4 + scales 1/0.85 | 521.3 | 6 |
| A18 | Typed dims + while + serial2 + scale 1 | 298.1 | **2** |
| A19 | Typed dims + for + parallel2 + scales 1/0.9 | 499.8 | 4 |
| A20 | Typed dims + for + serial2 + scales 1/0.9 | 531.6 | 3 |
| A21 | Typed dims + for + adaptive heavy policy + scale 1 | 576.5 | 2 |

**Chosen implementation (now in code):**
1. **Typed-array two-pass pipeline** is kept (best memory locality and no decode hoarding).
2. **Conservative canvas-limit scaling** is applied before render (`16384` edge cap, `67M` pixel cap).  
   This removes Firefox hard-fail cases for wide/tall 21+ batches and also reduces Safari runtime for oversized outputs.
3. For **21+ images**, lossy-min generation switches to **serial2** (JPEG + WebP one quality each), which is the best speed/memory balance among low-pressure variants (near-fastest while tied for best memory score).
4. Temporary canvases and blob URLs are still explicitly released to avoid leaks.

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
    name: zaladuplo
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

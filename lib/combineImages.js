'use strict';

const sharp = require('sharp');

/**
 * Combine an array of image buffers into a single PNG.
 * @param {Buffer[]} buffers
 * @param {'horizontal'|'vertical'} layout
 * @returns {Promise<Buffer>}
 */
async function combineImages(buffers, layout = 'horizontal') {
  // Decode metadata for every image
  const metas = await Promise.all(buffers.map((b) => sharp(b).metadata()));

  if (layout === 'vertical') {
    const width = Math.max(...metas.map((m) => m.width));
    const height = metas.reduce((sum, m) => sum + m.height, 0);

    const composites = [];
    let top = 0;
    for (let i = 0; i < buffers.length; i++) {
      composites.push({ input: buffers[i], top, left: 0 });
      top += metas[i].height;
    }

    return sharp({
      create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .composite(composites)
      .png()
      .toBuffer();
  }

  // Horizontal (default)
  const width = metas.reduce((sum, m) => sum + m.width, 0);
  const height = Math.max(...metas.map((m) => m.height));

  const composites = [];
  let left = 0;
  for (let i = 0; i < buffers.length; i++) {
    composites.push({ input: buffers[i], top: 0, left });
    left += metas[i].width;
  }

  return sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

module.exports = { combineImages };

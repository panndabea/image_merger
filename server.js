'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const { combineImages } = require('./lib/combineImages');

const app = express();
const PORT = process.env.PORT || 3000;

// Store uploads in memory (no disk writes needed)
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

app.use(express.static(path.join(__dirname, 'public')));

// POST /combine — receive images and return a single combined PNG
app.post('/combine', upload.array('images', 50), async (req, res) => {
  const files = req.files;

  if (!files || files.length < 2) {
    return res.status(400).json({ error: 'Please upload at least 2 images.' });
  }

  try {
    const layout = req.query.layout === 'vertical' ? 'vertical' : 'horizontal';
    const combined = await combineImages(files.map((f) => f.buffer), layout);
    res.set('Content-Type', 'image/png');
    res.send(combined);
  } catch (err) {
    console.error('Error combining images:', err);
    res.status(500).json({ error: 'Failed to combine images.' });
  }
});

app.listen(PORT, () => {
  console.log(`silver-engine listening on port ${PORT}`);
});

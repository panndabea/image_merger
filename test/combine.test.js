'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { combineImages } = require('../lib/combineImages');

// Helper: create a small solid-colour PNG buffer
async function solidPng(width, height, r, g, b) {
  return sharp({
    create: { width, height, channels: 4, background: { r, g, b, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

test('combines two images horizontally', async () => {
  const a = await solidPng(30, 20, 255, 0, 0);
  const b = await solidPng(40, 20, 0, 0, 255);
  const result = await combineImages([a, b], 'horizontal');
  const meta = await sharp(result).metadata();
  assert.equal(meta.width, 70);
  assert.equal(meta.height, 20);
});

test('combines two images vertically', async () => {
  const a = await solidPng(30, 20, 255, 0, 0);
  const b = await solidPng(30, 15, 0, 255, 0);
  const result = await combineImages([a, b], 'vertical');
  const meta = await sharp(result).metadata();
  assert.equal(meta.width, 30);
  assert.equal(meta.height, 35);
});

test('horizontal width is sum, height is max', async () => {
  const a = await solidPng(20, 50, 0, 0, 0);
  const b = await solidPng(20, 30, 128, 128, 128);
  const result = await combineImages([a, b], 'horizontal');
  const meta = await sharp(result).metadata();
  assert.equal(meta.width, 40);
  assert.equal(meta.height, 50);
});

test('combines three images horizontally', async () => {
  const a = await solidPng(10, 10, 255, 0, 0);
  const b = await solidPng(10, 10, 0, 255, 0);
  const c = await solidPng(10, 10, 0, 0, 255);
  const result = await combineImages([a, b, c], 'horizontal');
  const meta = await sharp(result).metadata();
  assert.equal(meta.width, 30);
  assert.equal(meta.height, 10);
});

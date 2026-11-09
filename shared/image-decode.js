'use strict';

const path = require('path');
const fs = require('fs');
const { MAX_IMAGE_PIXELS } = require('./asset-validation');

function createImageDecodeValidator({ nativeImage, fsModule = fs }) {
  if (!nativeImage || typeof nativeImage.createFromPath !== 'function') {
    throw new TypeError('nativeImage.createFromPathが必要です。');
  }

  const NATIVE_DECODABLE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
  const cache = new Map();

  return function validateImageDecodes(filePath, relativePath) {
    if (!NATIVE_DECODABLE_EXTENSIONS.has(path.extname(String(filePath)).toLowerCase())) return;
    const stat = fsModule.statSync(filePath);
    const cacheKey = `${path.resolve(filePath)}|${stat.size}|${stat.mtimeMs}`;
    if (cache.has(cacheKey)) {
      cache.delete(cacheKey);
      cache.set(cacheKey, true);
      return;
    }

    const image = nativeImage.createFromPath(filePath);
    if (!image || typeof image.isEmpty !== 'function' || image.isEmpty()) {
      throw new Error(`画像を読み込めません：${relativePath}`);
    }
    if (typeof image.getSize === 'function') {
      const dimensions = image.getSize();
      const width = Number(dimensions?.width);
      const height = Number(dimensions?.height);
      if (
        !Number.isFinite(width)
        || !Number.isFinite(height)
        || width <= 0
        || height <= 0
        || width * height > MAX_IMAGE_PIXELS
      ) {
        throw new Error(`画像は16MP以下にしてください：${relativePath}`);
      }
    }
    cache.set(cacheKey, true);
    if (cache.size > 500) cache.delete(cache.keys().next().value);
  };
}

module.exports = { createImageDecodeValidator };

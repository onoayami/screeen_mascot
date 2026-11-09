'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MAX_IMAGE_PIXELS } = require('./config-rules');

const ALLOWED_IMAGE_EXTENSIONS = Object.freeze([
  '.gif',
  '.png',
  '.webp',
  '.svg',
  '.jpg',
  '.jpeg',
]);
const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_GIF_FRAMES = 200;
const MAX_GIF_DECODED_PIXELS = 256_000_000;
const MAX_SVG_DIMENSION = 4096;

function assertImageFileSize(stat, label) {
  if (Number(stat?.size) > MAX_IMAGE_FILE_BYTES) {
    throw new Error(`画像は20MB以下にしてください：${label}`);
  }
}

function skipGifSubBlocks(data, offset) {
  let cursor = offset;
  while (cursor < data.length) {
    const length = data[cursor];
    cursor += 1;
    if (length === 0) return cursor;
    if (cursor + length > data.length) return -1;
    cursor += length;
  }
  return -1;
}

function validateGifResourceLimits(data, label) {
  if (data.length < 13) return;
  const logicalWidth = data.readUInt16LE(6);
  const logicalHeight = data.readUInt16LE(8);
  if (logicalWidth * logicalHeight > MAX_IMAGE_PIXELS) {
    throw new Error(`GIF画像は16MP以下にしてください：${label}`);
  }

  let offset = 13;
  const globalColorTable = (data[10] & 0x80) !== 0;
  if (globalColorTable) offset += 3 * (2 ** ((data[10] & 0x07) + 1));
  let frameCount = 0;
  let decodedPixels = 0;

  while (offset < data.length) {
    const marker = data[offset];
    offset += 1;
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      offset += 1;
      offset = skipGifSubBlocks(data, offset);
      if (offset < 0) break;
      continue;
    }
    if (marker !== 0x2c || offset + 9 > data.length) break;

    const frameWidth = data.readUInt16LE(offset + 4);
    const frameHeight = data.readUInt16LE(offset + 6);
    const packed = data[offset + 8];
    offset += 9;
    if ((packed & 0x80) !== 0) offset += 3 * (2 ** ((packed & 0x07) + 1));
    if (offset >= data.length) break;
    offset += 1;
    offset = skipGifSubBlocks(data, offset);
    if (offset < 0) break;

    frameCount += 1;
    decodedPixels += Math.max(1, frameWidth) * Math.max(1, frameHeight);
    if (frameCount > MAX_GIF_FRAMES) {
      throw new Error(`GIF画像は${MAX_GIF_FRAMES}フレーム以下にしてください：${label}`);
    }
    if (decodedPixels > MAX_GIF_DECODED_PIXELS) {
      throw new Error(`GIF画像の展開サイズが大きすぎます：${label}`);
    }
  }
}

function webpChunkDimensions(data, offset, chunkSize, declaredSize, label) {
  const chunkType = data.subarray(offset, offset + 4).toString('ascii');
  const payload = offset + 8;
  if (payload + chunkSize > declaredSize) {
    throw new Error(`WebP画像ヘッダーを読み取れません：${label}`);
  }

  if (chunkType === 'VP8X') {
    if (chunkSize < 10 || payload + 10 > data.length) {
      throw new Error(`WebP画像ヘッダーが正しくありません：${label}`);
    }
    return {
      width: data.readUIntLE(payload + 4, 3) + 1,
      height: data.readUIntLE(payload + 7, 3) + 1,
    };
  }

  if (chunkType === 'VP8L') {
    if (chunkSize < 5 || payload + 5 > data.length || data[payload] !== 0x2f) {
      throw new Error(`WebP画像ヘッダーが正しくありません：${label}`);
    }
    return {
      width: (data[payload + 1] | ((data[payload + 2] & 0x3f) << 8)) + 1,
      height: (
        ((data[payload + 2] & 0xc0) >> 6)
        | (data[payload + 3] << 2)
        | ((data[payload + 4] & 0x0f) << 10)
      ) + 1,
    };
  }

  if (chunkType === 'VP8 ') {
    if (
      chunkSize < 10
      || payload + 10 > data.length
      || data[payload + 3] !== 0x9d
      || data[payload + 4] !== 0x01
      || data[payload + 5] !== 0x2a
    ) {
      throw new Error(`WebP画像ヘッダーが正しくありません：${label}`);
    }
    return {
      width: data.readUInt16LE(payload + 6) & 0x3fff,
      height: data.readUInt16LE(payload + 8) & 0x3fff,
    };
  }

  return null;
}

function validateWebpResourceLimits(data, label) {
  const declaredSize = data.readUInt32LE(4) + 8;
  if (declaredSize < 12) throw new Error(`WebP画像ヘッダーが正しくありません：${label}`);
  let offset = 12;
  let foundDimensions = false;
  while (offset + 8 <= data.length && offset < declaredSize) {
    const chunkSize = data.readUInt32LE(offset + 4);
    const dimensions = webpChunkDimensions(data, offset, chunkSize, declaredSize, label);
    if (dimensions) {
      foundDimensions = true;
      if (
        dimensions.width <= 0
        || dimensions.height <= 0
        || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
      ) {
        throw new Error(`WebP画像は16MP以下にしてください：${label}`);
      }
    }
    const nextOffset = offset + 8 + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset) break;
    if (nextOffset > data.length) break;
    offset = nextOffset;
  }
  if (!foundDimensions) throw new Error(`WebP画像サイズを確認できません：${label}`);
}

function validateSvgResourceLimits(prefix, label) {
  if (/<!DOCTYPE|<!ENTITY/i.test(prefix)) {
    throw new Error(`SVG画像にDOCTYPEまたはENTITYは使用できません：${label}`);
  }
  const rootTag = prefix.match(/<svg\b[^>]*>/i)?.[0];
  if (!rootTag) return;
  for (const dimension of ['width', 'height']) {
    const value = rootTag.match(new RegExp(`\\b${dimension}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
    if (value === undefined || /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*%\s*$/i.test(value)) continue;
    const numeric = value.match(/^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/i);
    if (numeric && Number(numeric[1]) > MAX_SVG_DIMENSION) {
      throw new Error(`SVG画像の${dimension}は${MAX_SVG_DIMENSION}以下にしてください：${label}`);
    }
  }
}

function hasAllowedImageExtension(filePath) {
  return typeof filePath === 'string'
    && ALLOWED_IMAGE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function isLexicallyInsideRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function normalizeRelativeImagePath(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('画像パスが空です。');
  }
  const portable = value.trim().replace(/\\/g, '/');
  if (portable.includes('\0') || path.posix.isAbsolute(portable) || /^[A-Za-z]:\//.test(portable)) {
    throw new Error(`画像パスが相対パスではありません：${value}`);
  }
  const normalized = path.posix.normalize(portable);
  if (
    normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized !== portable
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`画像パスが素材フォルダの外を指しています：${value}`);
  }
  if (!hasAllowedImageExtension(normalized)) {
    throw new Error(`許可されていない画像形式です：${value}`);
  }
  return normalized;
}

function sha256File(filePath, fsModule = fs) {
  return crypto.createHash('sha256').update(fsModule.readFileSync(filePath)).digest('hex');
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readFileHead(filePath, byteCount, fsModule) {
  const descriptor = fsModule.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(byteCount);
    const bytesRead = fsModule.readSync(descriptor, buffer, 0, byteCount, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fsModule.closeSync(descriptor);
  }
}

function validateImageSignature(filePath, formatPath = filePath, fsModule = fs, label = formatPath) {
  if (!hasAllowedImageExtension(formatPath)) {
    throw new Error(`許可されていない画像形式です：${label}`);
  }
  const extension = path.extname(formatPath).toLowerCase();
  const data = extension === '.gif'
    ? fsModule.readFileSync(filePath)
    : readFileHead(filePath, 64 * 1024, fsModule);
  let valid = false;
  if (extension === '.png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    valid = data.length >= signature.length && signature.every((byte, index) => data[index] === byte);
  } else if (extension === '.gif') {
    const header = data.subarray(0, 6).toString('ascii');
    valid = header === 'GIF87a' || header === 'GIF89a';
    if (valid) validateGifResourceLimits(data, label);
  } else if (extension === '.jpg' || extension === '.jpeg') {
    valid = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  } else if (extension === '.webp') {
    valid = data.length >= 12
      && data.subarray(0, 4).toString('ascii') === 'RIFF'
      && data.subarray(8, 12).toString('ascii') === 'WEBP';
    if (valid) validateWebpResourceLimits(data, label);
  } else if (extension === '.svg') {
    const prefix = data
      .subarray(0, Math.min(data.length, 64 * 1024))
      .toString('utf8')
      .replace(/^\uFEFF/, '');
    valid = /<svg(?:\s|>)/i.test(prefix);
    if (valid) validateSvgResourceLimits(prefix, label);
  }
  if (!valid) throw new Error(`画像形式と内容が一致しません：${label}`);
  return true;
}

function validateStandaloneImageFile(filePath, {
  fsModule = fs,
  label = path.basename(String(filePath || '画像')),
  validateAsset,
} = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('画像ファイルを読み込めません。');
  }
  const resolved = path.resolve(filePath);
  if (!fsModule.existsSync(resolved)) {
    throw new Error(`画像ファイルが見つかりません：${label}`);
  }
  const lexicalStat = fsModule.lstatSync(resolved);
  if (lexicalStat.isSymbolicLink()) {
    throw new Error(`画像がシンボリックリンクです：${label}`);
  }
  if (!lexicalStat.isFile()) {
    throw new Error(`画像が通常ファイルではありません：${label}`);
  }
  assertImageFileSize(lexicalStat, label);
  const realPath = fsModule.realpathSync(resolved);
  const realStat = fsModule.statSync(realPath);
  if (!realStat.isFile()) {
    throw new Error(`画像の実体が通常ファイルではありません：${label}`);
  }
  assertImageFileSize(realStat, label);
  validateImageSignature(resolved, resolved, fsModule, label);
  if (typeof validateAsset === 'function') validateAsset(resolved, label);
  return resolved;
}

function resolveImageFileWithinRoot(rootPath, relativePath, {
  fsModule = fs,
  validateAsset,
} = {}) {
  const normalized = normalizeRelativeImagePath(relativePath);
  const root = path.resolve(rootPath);
  if (!fsModule.existsSync(root)) {
    throw new Error(`素材フォルダが見つかりません：${rootPath}`);
  }
  const rootStat = fsModule.lstatSync(root);
  if (rootStat.isSymbolicLink()) {
    throw new Error(`素材フォルダがシンボリックリンクです：${rootPath}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`素材フォルダが通常のフォルダではありません：${rootPath}`);
  }
  const candidate = path.resolve(root, ...normalized.split('/'));
  if (!isLexicallyInsideRoot(root, candidate)) {
    throw new Error(`画像パスが素材フォルダの外を指しています：${relativePath}`);
  }
  if (!fsModule.existsSync(candidate)) {
    const error = new Error(`参照画像が見つかりません：${relativePath}`);
    error.assetUnavailable = true;
    throw error;
  }
  const lexicalStat = fsModule.lstatSync(candidate);
  if (lexicalStat.isSymbolicLink()) {
    throw new Error(`参照画像がシンボリックリンクです：${relativePath}`);
  }
  if (!lexicalStat.isFile()) {
    throw new Error(`参照画像が通常ファイルではありません：${relativePath}`);
  }
  try {
    assertImageFileSize(lexicalStat, relativePath);
  } catch (error) {
    error.assetContentInvalid = true;
    throw error;
  }

  const realRoot = fsModule.realpathSync(root);
  const realCandidate = fsModule.realpathSync(candidate);
  if (!isLexicallyInsideRoot(realRoot, realCandidate)) {
    throw new Error(`参照画像の実体が素材フォルダの外にあります：${relativePath}`);
  }
  const realCandidateStat = fsModule.statSync(realCandidate);
  if (!realCandidateStat.isFile()) {
    throw new Error(`参照画像の実体が通常ファイルではありません：${relativePath}`);
  }
  try {
    assertImageFileSize(realCandidateStat, relativePath);
    validateImageSignature(candidate, normalized, fsModule);
    if (typeof validateAsset === 'function') validateAsset(candidate, normalized);
  } catch (error) {
    if (!error?.code) error.assetContentInvalid = true;
    throw error;
  }
  return candidate;
}

function copyValidatedImageFile({
  sourceFile,
  destinationFile,
  fsModule = fs,
  validateAsset,
}) {
  const source = validateStandaloneImageFile(sourceFile, {
    fsModule,
    label: path.basename(sourceFile),
    validateAsset,
  });
  try {
    fsModule.copyFileSync(source, destinationFile);
    validateStandaloneImageFile(destinationFile, {
      fsModule,
      label: path.basename(destinationFile),
    });
    if (sha256File(source, fsModule) !== sha256File(destinationFile, fsModule)) {
      throw new Error(`コピー後の画像ハッシュが一致しません：${path.basename(sourceFile)}`);
    }
    return destinationFile;
  } catch (error) {
    fsModule.rmSync(destinationFile, { force: true });
    throw error;
  }
}

module.exports = {
  ALLOWED_IMAGE_EXTENSIONS,
  MAX_GIF_DECODED_PIXELS,
  MAX_GIF_FRAMES,
  MAX_IMAGE_FILE_BYTES,
  MAX_IMAGE_PIXELS,
  copyValidatedImageFile,
  hasAllowedImageExtension,
  isLexicallyInsideRoot,
  normalizeRelativeImagePath,
  resolveImageFileWithinRoot,
  sha256Buffer,
  sha256File,
  validateImageSignature,
  validateStandaloneImageFile,
};

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  loadMainForTest,
  loadRendererForTest,
  loadSettingsForTest,
} from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function projectRequire(projectRoot) {
  return createRequire(path.join(projectRoot, 'package.json'));
}

function validAction(index = 0) {
  return {
    name: `動作${index + 1}`,
    file: 'actions/rest.svg',
    weight: 1,
    durationMs: [1000, 2000],
    movement: { type: 'still', speed: 0 },
  };
}

function webpVp8x(width, height) {
  const content = Buffer.alloc(30);
  content.write('RIFF', 0);
  content.writeUInt32LE(content.length - 8, 4);
  content.write('WEBPVP8X', 8);
  content.writeUInt32LE(10, 16);
  content.writeUIntLE(width - 1, 24, 3);
  content.writeUIntLE(height - 1, 27, 3);
  return content;
}

test('WebP and SVG resource limits are checked without rejecting ordinary SVG units or viewBox values', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const validation = projectRequire(projectRoot)('./shared/asset-validation.js');
    const directory = path.join(projectRoot, 'asset-limit-probes');
    fs.mkdirSync(directory);
    const webpPath = path.join(directory, 'large.webp');
    fs.writeFileSync(webpPath, webpVp8x(4096, 4096));
    assert.throws(
      () => validation.validateImageSignature(webpPath, webpPath),
      /16MP以下/,
    );
    fs.writeFileSync(webpPath, webpVp8x(4000, 4000));
    assert.equal(validation.validateImageSignature(webpPath, webpPath), true);

    const svgPath = path.join(directory, 'image.svg');
    fs.writeFileSync(
      svgPath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="100%" viewBox="0 0 99999 99999"/>',
    );
    assert.equal(validation.validateImageSignature(svgPath, svgPath), true);
    fs.writeFileSync(svgPath, '<svg width="5000px" height="20"/>');
    assert.throws(
      () => validation.validateImageSignature(svgPath, svgPath),
      /widthは4096以下/,
    );
    fs.writeFileSync(svgPath, '<!DOCTYPE svg [<!ENTITY x "x">]><svg width="1" height="1"/>');
    assert.throws(
      () => validation.validateImageSignature(svgPath, svgPath),
      /DOCTYPEまたはENTITY/,
    );
  });
});

test('PNG/JPEG decode validation caches only successful size-and-mtime matches', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const { createImageDecodeValidator } = projectRequire(projectRoot)('./shared/image-decode.js');
    const filePath = path.join(projectRoot, 'decode-cache.png');
    fs.writeFileSync(filePath, 'x');
    let decodeCalls = 0;
    let shouldFail = true;
    const validate = createImageDecodeValidator({
      nativeImage: {
        createFromPath() {
          decodeCalls += 1;
          return {
            isEmpty: () => shouldFail,
            getSize: () => ({ width: 1, height: 1 }),
          };
        },
      },
    });

    assert.throws(() => validate(filePath, 'decode-cache.png'), /読み込めません/);
    shouldFail = false;
    validate(filePath, 'decode-cache.png');
    validate(filePath, 'decode-cache.png');
    assert.equal(decodeCalls, 2);
    const later = new Date(Date.now() + 2000);
    fs.utimesSync(filePath, later, later);
    validate(filePath, 'decode-cache.png');
    assert.equal(decodeCalls, 3);
  });
});

test('asset metadata checks safe paths without performing a native image decode', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    let decodeCalls = 0;
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      nativeImageOverrides: {
        createFromPath() {
          decodeCalls += 1;
          return { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) };
        },
      },
    });
    fs.writeFileSync(path.join(userCharacters, 'actions', 'metadata.png'), PNG_SIGNATURE);
    assert.equal(main.api.getCharacterAssetMetadata('actions/metadata.png').size, PNG_SIGNATURE.length);
    assert.equal(decodeCalls, 0);
  });
});

test('validated image copies decode the source once and verify destination bytes by hash', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const validation = projectRequire(projectRoot)('./shared/asset-validation.js');
    const sourcePath = path.join(projectRoot, 'copy-source.png');
    const destinationPath = path.join(projectRoot, 'copy-destination.png');
    fs.writeFileSync(sourcePath, PNG_SIGNATURE);
    let decodeCalls = 0;
    validation.copyValidatedImageFile({
      sourceFile: sourcePath,
      destinationFile: destinationPath,
      validateAsset: () => { decodeCalls += 1; },
    });
    assert.equal(decodeCalls, 1);
    assert.deepEqual(fs.readFileSync(destinationPath), PNG_SIGNATURE);
  });
});

test('image publication never overwrites a destination created after name selection', async () => {
  await withTemporaryProject(async ({ projectRoot, userCharacters }) => {
    const main = loadMainForTest({ projectRoot });
    const directory = path.join(userCharacters, 'actions');
    const plannedPath = main.api.uniqueDestination(directory, 'publication-collision.png');
    const candidatePath = plannedPath;
    const temporaryPath = path.join(projectRoot, 'publication-source.tmp');
    fs.writeFileSync(candidatePath, 'existing');
    fs.writeFileSync(temporaryPath, 'new image');

    const published = main.api.publishImageTemporary(
      temporaryPath,
      directory,
      path.basename(plannedPath),
    );
    assert.equal(path.basename(published), 'publication-collision-2.png');
    assert.equal(fs.readFileSync(candidatePath, 'utf8'), 'existing');
    assert.equal(fs.readFileSync(published, 'utf8'), 'new image');
    assert.equal(fs.existsSync(temporaryPath), false);
  });
});

test('C-01: configurations reject more than 100 actions', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const rules = projectRequire(projectRoot)('./shared/config-rules.js');
    const input = {
      name: '上限テスト',
      mascot: {},
      actions: Array.from({ length: 101 }, (_, index) => validAction(index)),
    };
    assert.throws(
      () => rules.validateAndNormalizeConfig(input),
      /100|動作.*上限|件まで/,
    );
  });
});

test('C-02: standalone images larger than 20 MB are rejected before decoding', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const validation = projectRequire(projectRoot)('./shared/asset-validation.js');
    const source = path.join(projectRoot, 'oversized.png');
    fs.writeFileSync(source, PNG_SIGNATURE);
    fs.truncateSync(source, 20 * 1024 * 1024 + 1);
    assert.throws(
      () => validation.validateStandaloneImageFile(source),
      /20\s*MB|20MB|容量|サイズ/,
    );
  });
});

test('C-03: decoded images larger than 16 MP are rejected', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const source = path.join(projectRoot, 'too-many-pixels.png');
    fs.writeFileSync(source, PNG_SIGNATURE);
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      nativeImageOverrides: {
        createFromPath() {
          return {
            isEmpty: () => false,
            getSize: () => ({ width: 4097, height: 4097 }),
          };
        },
      },
    });
    assert.throws(
      () => main.api.importImageFromPath(source, 'actions'),
      /16\s*MP|16MP|画素/,
    );
  });
});

test('C-04: asset metadata exposes size and mtime for cache invalidation', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const main = loadMainForTest({ projectRoot, userDataRoot });
    assert.equal(typeof main.api.getCharacterAssetMetadata, 'function');
    const metadata = main.api.getCharacterAssetMetadata('actions/rest.svg');
    assert.ok(Number.isFinite(metadata.size) && metadata.size > 0);
    assert.ok(Number.isFinite(metadata.mtimeMs) && metadata.mtimeMs > 0);
    assert.equal(typeof metadata.cacheKey, 'string');
    assert.match(metadata.cacheKey, /:\d/);
  });
});

test('C-05: image resolution preserves order with at most four concurrent decodes', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot });
    assert.equal(typeof renderer.api.mapWithConcurrency, 'function');
    let active = 0;
    let maximumActive = 0;
    const items = Array.from({ length: 24 }, (_, index) => index);
    const output = await renderer.api.mapWithConcurrency(items, 4, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return value * 2;
    });
    assert.ok(maximumActive <= 4, `maximum concurrency was ${maximumActive}`);
    assert.deepEqual([...output], items.map((value) => value * 2));
  });
});

test('C-06: measurement cache is versioned, expires after six seconds, and stays bounded', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    let imageCreations = 0;
    let now = 1000;
    class SuccessfulImage {
      constructor() {
        imageCreations += 1;
        this.naturalWidth = 10;
        this.naturalHeight = 10;
      }
      set src(_value) { queueMicrotask(() => this.onload?.()); }
    }
    const settings = loadSettingsForTest({
      projectRoot,
      ImageClass: SuccessfulImage,
      now: () => now,
    });

    for (let index = 0; index < 101; index += 1) {
      await settings.api.measureVisibleContent(`file://cache-${index}.png`, `v${index}`);
    }
    assert.ok(settings.api.sizeMeasurementCache.size <= 100);

    const beforeVersionChecks = imageCreations;
    await settings.api.measureVisibleContent('file://updated.png', 'size:1:mtime:1');
    await settings.api.measureVisibleContent('file://updated.png', 'size:1:mtime:1');
    assert.equal(imageCreations, beforeVersionChecks + 1);
    await settings.api.measureVisibleContent('file://updated.png', 'size:2:mtime:2');
    assert.equal(imageCreations, beforeVersionChecks + 2);

    now += 6001;
    await settings.api.measureVisibleContent('file://updated.png', 'size:2:mtime:2');
    assert.equal(imageCreations, beforeVersionChecks + 3);
  });
});

test('C-07: trail effects are capped at 100 and can be released together', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot });
    assert.equal(typeof renderer.api.createEffect, 'function');
    assert.equal(typeof renderer.api.clearEffects, 'function');
    renderer.api.state.config = { mascot: { size: 180, margin: 0 } };
    renderer.api.state.currentAction = {
      effect: {
        assetUrl: 'file://effect.png',
        size: 12,
        lifetimeMs: 60_000,
        offsetX: 0,
        offsetY: 0,
      },
    };
    for (let index = 0; index < 105; index += 1) renderer.api.createEffect();
    assert.ok(renderer.api.state.effectEntries.length <= 100);
    const stage = renderer.nodes.get('stage');
    assert.ok(stage.children.filter((child) => !child.removed).length <= 100);
    renderer.api.clearEffects();
    assert.equal(renderer.api.state.effectEntries.length, 0);
    assert.equal(stage.children.filter((child) => !child.removed).length, 0);
  });
});

test('C-08: size-manager and JPEG generations invalidate stale asynchronous work', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    assert.equal(typeof settings.api.beginSizeManagerGeneration, 'function');
    assert.equal(typeof settings.api.isSizeManagerGenerationCurrent, 'function');
    assert.equal(typeof settings.api.beginJpegGeneration, 'function');
    assert.equal(typeof settings.api.isJpegGenerationCurrent, 'function');
    assert.equal(typeof settings.api.invalidateJpegGeneration, 'function');

    const sizeOne = settings.api.beginSizeManagerGeneration();
    const sizeTwo = settings.api.beginSizeManagerGeneration();
    assert.equal(settings.api.isSizeManagerGenerationCurrent(sizeOne), false);
    assert.equal(settings.api.isSizeManagerGenerationCurrent(sizeTwo), true);

    const jpegOne = settings.api.beginJpegGeneration();
    const jpegTwo = settings.api.beginJpegGeneration();
    assert.equal(settings.api.isJpegGenerationCurrent(jpegOne), false);
    assert.equal(settings.api.isJpegGenerationCurrent(jpegTwo), true);
    settings.api.invalidateJpegGeneration(jpegTwo);
    assert.equal(settings.api.isJpegGenerationCurrent(jpegTwo), false);
  });
});

test('C-09: JPEG imports do not duplicate the image as a Base64 IPC payload', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const source = path.join(projectRoot, 'photo.jpg');
    fs.writeFileSync(source, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const main = loadMainForTest({ projectRoot, userDataRoot });
    const result = main.api.importImageFromPath(source, 'actions');
    assert.equal(Object.hasOwn(result, 'previewDataUrl'), false);
    assert.equal(result.isJpeg, true);
  });
});

test('new imported JPEGs can be discarded only while absent from persisted configuration', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const source = path.join(projectRoot, 'cleanup-photo.jpg');
    fs.writeFileSync(source, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const main = loadMainForTest({ projectRoot, userDataRoot });
    const imported = main.api.importImageFromPath(source, 'actions');
    const importedPath = path.join(userCharacters, imported.relativePath);
    assert.equal(fs.existsSync(importedPath), true);

    const configPath = path.join(userCharacters, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.actions[0].file = imported.relativePath;
    fs.writeFileSync(configPath, JSON.stringify(config));
    assert.equal(main.api.discardImportedImage(imported.relativePath, 'actions'), false);
    assert.equal(fs.existsSync(importedPath), true);

    config.actions[0].file = 'actions/rest.svg';
    fs.writeFileSync(configPath, JSON.stringify(config));
    assert.equal(main.api.discardImportedImage(imported.relativePath, 'actions'), true);
    assert.equal(fs.existsSync(importedPath), false);
    assert.equal(main.api.discardImportedImage('actions/not-a-session-jpg.png', 'actions'), false);
    assert.equal(main.api.discardImportedImage('actions/rest.svg', 'actions'), false);
  });
});

test('C-10: GIF animation frame counts are bounded', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const validation = projectRequire(projectRoot)('./shared/asset-validation.js');
    const header = Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
      0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
    ]);
    const frame = Buffer.from([
      0x2c,
      0x00, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x00,
      0x00,
      0x02,
      0x02, 0x44, 0x01,
      0x00,
    ]);
    const source = path.join(projectRoot, 'too-many-frames.gif');
    fs.writeFileSync(source, Buffer.concat([
      header,
      ...Array.from({ length: 201 }, () => frame),
      Buffer.from([0x3b]),
    ]));
    assert.throws(
      () => validation.validateStandaloneImageFile(source),
      /200.*フレーム|フレーム.*200/,
    );
  });
});

test('C-11: settings stop adding actions at the 100-action limit', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    settings.api.state.actions = Array.from({ length: 100 }, (_, index) => ({
      _uiId: `action-${index}`,
      name: `動作${index + 1}`,
    }));
    settings.api.addAction();
    assert.equal(settings.api.state.actions.length, 100);
    assert.match(settings.api.elements.feedback.textContent, /100件/);
    assert.equal(settings.api.elements.addAction.disabled, true);
  });
});

test('C-12: size measurements also use a four-worker queue', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    let active = 0;
    let maximumActive = 0;
    const output = await settings.api.mapWithConcurrency(
      Array.from({ length: 16 }, (_, index) => index),
      4,
      async (value) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return value;
      },
    );
    assert.ok(maximumActive <= 4, `maximum concurrency was ${maximumActive}`);
    assert.equal(output.length, 16);
  });
});

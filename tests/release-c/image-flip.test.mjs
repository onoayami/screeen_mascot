import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  loadRendererForTest,
  loadSettingsForTest,
} from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

class InstantImage {
  constructor() {
    this.naturalWidth = 1;
    this.naturalHeight = 1;
    this.width = 1;
    this.height = 1;
  }

  set src(value) {
    this.source = value;
    queueMicrotask(() => this.onload?.());
  }
}

function createConfig(imageTransform = {}) {
  return {
    name: '左右反転テスト',
    mascot: { size: 100, startPosition: 'bottom-right', margin: 40, rememberPosition: true },
    actions: [{
      name: '動作',
      file: 'actions/left-arrow.svg',
      weight: 1,
      durationMs: [6000, 10000],
      flipMode: 'direction',
      imageTransform: { scale: 1, offsetX: 0, offsetY: 0, ...imageTransform },
      movement: { type: 'still', speed: 0 },
      effect: {
        file: 'effects/dot.png',
        intervalMs: 450,
        size: 10,
        lifetimeMs: 1000,
        offsetX: 40,
        offsetY: 13,
        coordinateVersion: 2,
        emitWhileStill: true,
      },
    }],
  };
}

function createMeasuredAction(imageTransform) {
  return {
    _uiId: 'asymmetric-action',
    _assetUrl: 'file:///left-asymmetric.svg',
    name: '非対称画像',
    file: 'actions/left-asymmetric.svg',
    weight: 1,
    durationMs: [6000, 10000],
    flipMode: 'direction',
    imageTransform: { scale: 1, offsetX: 0, offsetY: 0, ...imageTransform },
    movement: { type: 'still', speed: 0 },
  };
}

const asymmetricMeasurement = {
  baseWidth: 0.9,
  baseHeight: 0.4,
  centerX: 0.8,
  centerY: 0.5,
};

function cacheMeasurement(settings, action) {
  settings.mascotAPI.getAssetMetadata = async (file) => ({ cacheKey: file });
  settings.api.sizeMeasurementCache.set(`${action._assetUrl}|${action.file}`, {
    promise: Promise.resolve(asymmetricMeasurement),
    expiresAt: Date.now() + 60_000,
  });
}

test('shared config rules default flipX to false and reject non-booleans', () => {
  const require = createRequire(import.meta.url);
  const { validateAndNormalizeConfig } = require('../../shared/config-rules.js');
  const config = (imageTransform) => ({
    name: 'test',
    mascot: {},
    actions: [{ name: 'left', file: 'actions/left.svg', ...(imageTransform === undefined ? {} : { imageTransform }) }],
  });

  assert.equal(validateAndNormalizeConfig(config(undefined)).actions[0].imageTransform.flipX, false);
  for (const flipX of [true, false]) {
    assert.equal(
      validateAndNormalizeConfig(config({ flipX })).actions[0].imageTransform.flipX,
      flipX,
    );
  }
  assert.throws(
    () => validateAndNormalizeConfig(config({ flipX: 'true' })),
    /actions\[0\]\.imageTransform\.flipX はtrueまたはfalseにしてください。/,
  );
});

test('renderer composes base and directional flips and mirrors only effect horizontal offsets', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot, random: () => 0.1 });
    const { api, nodes } = renderer;
    api.state.config = { mascot: { size: 100 } };
    api.state.position = { x: 20, y: 30 };

    for (const flipX of [false, true]) {
      for (const [direction, expectedDirectionalFlip] of [[1, 1], [-1, -1]]) {
        api.state.facing = direction;
        api.setAction({
          assetUrl: 'file:///left-arrow.svg',
          flipMode: 'direction',
          imageTransform: { flipX, scale: 1, offsetX: 0, offsetY: 0 },
          movement: { type: 'still', speed: 0 },
          effect: {
            assetUrl: 'file:///dot.png',
            size: 10,
            lifetimeMs: 1000,
            offsetX: 40,
            offsetY: 13,
          },
        });
        api.state.velocity.x = direction;
        api.applyFlip();

        assert.equal(nodes.get('mascot-image').style['--image-base-flip-x'], flipX ? '-1' : '1');
        assert.equal(nodes.get('mascot-image').style['--image-flip-x'], String(expectedDirectionalFlip));
        assert.equal(api.state.directionalFlip, expectedDirectionalFlip);
        const entry = api.createEffect();
        assert.equal(
          entry.element.style.left,
          `${20 + 50 + 40 * expectedDirectionalFlip}px`,
        );
        assert.equal(entry.element.style.top, '117px');
        api.clearEffects();
      }
    }

    for (const [flipMode, random, expected] of [
      ['random', 0.1, -1],
      ['none', 0.1, 1],
    ]) {
      const fixedRandom = loadRendererForTest({ projectRoot, random: () => random });
      fixedRandom.api.state.config = { mascot: { size: 100 } };
      fixedRandom.api.state.position = { x: 20, y: 30 };
      fixedRandom.api.setAction({
        assetUrl: 'file:///left-arrow.svg',
        flipMode,
        imageTransform: { flipX: true, scale: 1, offsetX: 0, offsetY: 0 },
        movement: { type: 'still', speed: 0 },
        effect: {
          assetUrl: 'file:///dot.png',
          size: 10,
          lifetimeMs: 1000,
          offsetX: 40,
          offsetY: 13,
        },
      });
      const entry = fixedRandom.api.createEffect();
      assert.equal(fixedRandom.api.state.directionalFlip, expected);
      assert.equal(entry.element.style.left, `${20 + 50 + 40 * expected}px`);
      assert.equal(entry.element.style.top, '117px');
      fixedRandom.api.clearEffects();
    }
  });
});

test('settings checkbox loads legacy values, updates previews, and saves flipX', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const savedPayloads = [];
    const settings = loadSettingsForTest({
      projectRoot,
      ImageClass: InstantImage,
      mascotAPI: {
        loadConfig: async () => ({ config: createConfig() }),
        saveConfig: async (config) => {
          savedPayloads.push(config);
          return { ok: true, applied: true, config };
        },
      },
    });

    await settings.api.loadConfiguration();
    const action = settings.api.state.actions[0];
    const checkbox = settings.nodes.get('image-flip-x');
    assert.equal(action.imageTransform.flipX, false);
    assert.equal(checkbox.checked, false);
    assert.doesNotMatch(settings.nodes.get('action-preview').style.transform, /scaleX\(-1\)/);

    checkbox.checked = true;
    checkbox.dispatchEvent({ type: 'change' });
    assert.equal(settings.api.state.dirty, true);
    assert.equal(action.imageTransform.flipX, true);
    assert.match(settings.nodes.get('action-preview').style.transform, /scaleX\(-1\)/);
    assert.match(settings.nodes.get('effect-live-mascot-image').style.transform, /scaleX\(-1\)/);
    assert.equal(await settings.api.saveConfiguration(), true);
    assert.equal(savedPayloads[0].actions[0].imageTransform.flipX, true);
  });
});

test('trimming flipX is temporary until apply and reset clears it', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({
      projectRoot,
      ImageClass: InstantImage,
      mascotAPI: { loadConfig: async () => ({ config: createConfig() }) },
    });
    await settings.api.loadConfiguration();
    const action = settings.api.state.actions[0];
    const checkbox = settings.nodes.get('image-editor-flip-x');
    const preview = settings.nodes.get('image-editor-preview');

    settings.api.openImageEditor();
    checkbox.checked = true;
    checkbox.onchange();
    assert.match(preview.style.transform, /scaleX\(-1\)/);
    assert.equal(action.imageTransform.flipX, false);
    settings.nodes.get('image-editor-cancel').onclick();
    assert.equal(action.imageTransform.flipX, false);

    settings.api.openImageEditor();
    checkbox.checked = true;
    checkbox.onchange();
    settings.nodes.get('image-editor-reset').onclick();
    assert.equal(checkbox.checked, false);
    assert.doesNotMatch(preview.style.transform, /scaleX\(-1\)/);
    checkbox.checked = true;
    checkbox.onchange();
    settings.nodes.get('image-editor-apply').onclick();
    assert.equal(action.imageTransform.flipX, true);
  });
});

test('clipping, frame fitting, and size alignment use the mirrored content center', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot, ImageClass: InstantImage });
    const { api } = settings;
    const mirrored = api.measurementForTransform(asymmetricMeasurement, { flipX: true });
    assert.ok(Math.abs(mirrored.centerX - 0.2) < 1e-12);

    const fitted = api.fitTransformToFrame(asymmetricMeasurement, {
      flipX: true,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    const unflippedFit = api.fitTransformToFrame(asymmetricMeasurement, {
      flipX: false,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    assert.equal(fitted.offsetX, 27.5);
    assert.equal(unflippedFit.offsetX, -27.5);
    assert.equal(api.computeClipping(asymmetricMeasurement, fitted).clipped, false);
    assert.equal(api.computeClipping(asymmetricMeasurement, unflippedFit).clipped, false);

    const action = createMeasuredAction({ flipX: true });
    api.state.config = {
      name: '左右反転サイズ調整',
      mascot: { size: 180, startPosition: 'bottom-right', margin: 40, rememberPosition: true },
    };
    api.state.actions = [action];
    api.state.selectedId = action._uiId;
    api.state.dirty = false;
    cacheMeasurement(settings, action);
    await api.getActionMeasurement(action);
    assert.equal(api.fitActionIntoFrame(action), true);
    assert.equal(action.imageTransform.offsetX, 27.5);
    assert.equal(api.computeClipping(asymmetricMeasurement, action.imageTransform).clipped, false);
    settings.nodes.get('open-size-manager').dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    api.elements.sizeManagerAuto.onclick();
    await api.elements.sizeManagerSave.onclick();
    assert.equal(action.imageTransform.flipX, true);
    assert.equal(action.imageTransform.offsetX, 30);
    assert.equal(api.computeClipping(asymmetricMeasurement, action.imageTransform).clipped, false);
  });
});

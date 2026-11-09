import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSettingsForTest } from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

function createAction(id, imageTransform = { scale: 1, offsetX: 0, offsetY: 0 }) {
  return {
    _uiId: id,
    name: id,
    file: `actions/${id}.png`,
    weight: 1,
    durationMs: [6000, 10000],
    flipMode: 'none',
    imageTransform: { ...imageTransform },
    movement: { type: 'still', speed: 0 },
    _assetUrl: `file://${id}.png`,
  };
}

function configureSettings(settings, actions, selectedId = actions[0]?._uiId) {
  settings.api.state.config = {
    name: '見切れテスト',
    mascot: { size: 180, startPosition: 'bottom-right', margin: 40, rememberPosition: true },
  };
  settings.api.state.actions = actions;
  settings.api.state.selectedId = selectedId;
  settings.api.state.dirty = false;
  settings.api.actionMeasurements.clear();
  settings.api.sizeMeasurementCache.clear();
  settings.mascotAPI.getAssetMetadata = async (file) => ({ cacheKey: file });
}

function legacyTransparentPixels(original, background, tolerance, feather) {
  const output = new Uint8ClampedArray(original.data);
  for (let index = 0; index < output.length; index += 4) {
    const deltaR = output[index] - background.r;
    const deltaG = output[index + 1] - background.g;
    const deltaB = output[index + 2] - background.b;
    const distance = Math.sqrt(deltaR ** 2 + deltaG ** 2 + deltaB ** 2);
    if (distance <= tolerance) output[index + 3] = 0;
    else if (feather > 0 && distance < tolerance + feather) {
      output[index + 3] = Math.round(255 * ((distance - tolerance) / feather));
    } else output[index + 3] = 255;
  }
  return output;
}

function cacheMeasurement(settings, action, measurement) {
  settings.api.sizeMeasurementCache.set(`${action._assetUrl}|${action.file}`, {
    promise: Promise.resolve(measurement),
    expiresAt: Date.now() + 60_000,
  });
}

async function prepareMeasurements(settings, entries) {
  for (const [action, measurement] of entries) {
    cacheMeasurement(settings, action, measurement);
    await settings.api.getActionMeasurement(action);
  }
}

function fullFrame(width = 1, height = width, centerX = 0.5, centerY = 0.5) {
  return { baseWidth: width, baseHeight: height, centerX, centerY };
}

async function openSizeManager(settings) {
  settings.nodes.get('open-size-manager').dispatchEvent({ type: 'click' });
  await new Promise((resolve) => setTimeout(resolve, 10));
}

test('transparent conversion stays pixel-identical at thresholds with zero and nonzero feather', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    const background = { r: 10.5, g: 20, b: 30.25 };
    const threshold = Math.sqrt(30.3125);
    const original = {
      width: 6,
      height: 1,
      data: new Uint8ClampedArray([
        10, 20, 30, 255,
        16, 20, 30, 177,
        17, 20, 30, 120,
        19, 20, 30, 0,
        20, 20, 30, 64,
        10, 25, 30, 33,
      ]),
    };

    for (const feather of [0, 4]) {
      const expected = legacyTransparentPixels(original, background, threshold, feather);
      const actual = settings.api.makeTransparentImageData(original, background, threshold, feather);
      assert.deepEqual(Array.from(actual.data), Array.from(expected), `feather=${feather}`);
    }
  });
});

test('clipping reports overflowing edges and allows the 0.5% tolerance', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    const compute = settings.api.computeClipping;

    assert.equal(compute(fullFrame(), { scale: 1, offsetX: 0, offsetY: 0 }).clipped, false);
    const bottom = compute(fullFrame(), { scale: 1, offsetX: 0, offsetY: 10 });
    assert.equal(bottom.edges[0].edge, 'bottom');
    assert.ok(Math.abs(bottom.edges[0].percent - 10) < 1e-10);

    const bothVerticalEdges = compute(fullFrame(0.5, 1), { scale: 1.23, offsetX: 0, offsetY: 0 });
    assert.deepEqual(
      Array.from(bothVerticalEdges.edges, ({ edge }) => edge),
      ['top', 'bottom'],
    );
    assert.ok(Math.abs(bothVerticalEdges.edges[0].percent - 11.5) < 1e-10);

    assert.deepEqual(
      Array.from(compute(fullFrame(1, 0.9), { scale: 1, offsetX: -10, offsetY: 0 }).edges, ({ edge }) => edge),
      ['left'],
    );
    assert.deepEqual(
      Array.from(compute(fullFrame(1, 0.9), { scale: 1, offsetX: 10, offsetY: 0 }).edges, ({ edge }) => edge),
      ['right'],
    );
    const tolerated = compute(fullFrame(1, 0.9), { scale: 1, offsetX: 0.5, offsetY: 0 });
    assert.equal(tolerated.clipped, false);
  });
});

test('near-edge and exact-frame images are not clipped', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    const compute = settings.api.computeClipping;
    const onePercent = compute(fullFrame(0.5, 0.5, 0.26, 0.5), {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    const threePercent = compute(fullFrame(0.5, 0.5, 0.28, 0.5), {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });

    assert.equal(onePercent.clipped, false);
    assert.equal(threePercent.clipped, false);
    assert.equal(compute(fullFrame(0.98), { scale: 1, offsetX: 0, offsetY: 0 }).clipped, false);
    assert.equal(compute(fullFrame(), { scale: 1, offsetX: 0, offsetY: 0 }).clipped, false);
  });
});

test('fit scales to 92% and respects transform bounds', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    const fit = settings.api.fitTransformToFrame;
    const fitted = fit(fullFrame(), { scale: 1.23, offsetX: 10, offsetY: -20 });
    assert.deepEqual(JSON.parse(JSON.stringify(fitted)), {
      flipX: false,
      scale: 0.92,
      offsetX: 1.5,
      offsetY: -1.5,
    });
    const fittedStatus = settings.api.computeClipping(fullFrame(), fitted);
    assert.equal(fittedStatus.clipped, false);

    const touchingImage = fit(fullFrame(), { scale: 1, offsetX: 0, offsetY: 0 });
    assert.equal(touchingImage.scale, 0.92);
    assert.equal(touchingImage.offsetX, 0);
    assert.equal(touchingImage.offsetY, 0);
    const touchingStatus = settings.api.computeClipping(fullFrame(), touchingImage);
    assert.ok(Math.abs(touchingStatus.bounds.left - 0.04) < 1e-10);
    assert.ok(Math.abs(touchingStatus.bounds.right - 0.96) < 1e-10);
    assert.ok(Math.abs(touchingStatus.bounds.top - 0.04) < 1e-10);
    assert.ok(Math.abs(touchingStatus.bounds.bottom - 0.96) < 1e-10);

    const minScale = fit(fullFrame(), { scale: 0.3, offsetX: 200, offsetY: -200 });
    assert.equal(minScale.scale, 0.3);
    assert.equal(minScale.offsetX, 32.5);
    assert.equal(minScale.offsetY, -32.5);
    assert.ok(minScale.offsetX >= -100 && minScale.offsetX <= 100);
    assert.ok(minScale.offsetY >= -100 && minScale.offsetY <= 100);
    assert.equal(settings.api.computeClipping(fullFrame(), minScale).clipped, false);
  });
});

test('STEP 1 warns and fits only clipped images', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    const clipped = createAction('clipped', { scale: 1.23, offsetX: 10, offsetY: 0 });
    const nearEdge = createAction('near-edge');
    const untouched = createAction('untouched', { scale: 0.6, offsetX: 0, offsetY: 0 });
    configureSettings(settings, [clipped, nearEdge, untouched]);
    await prepareMeasurements(settings, [
      [clipped, fullFrame()],
      [nearEdge, fullFrame(0.5, 0.5, 0.26, 0.5)],
      [untouched, fullFrame()],
    ]);

    settings.api.renderActionList();
    settings.api.renderEditor();
    assert.equal(settings.api.elements.actionClippingStatus.textContent, '⚠画像が枠からはみ出しています');
    assert.equal(settings.api.elements.actionFitInFrame.hidden, false);
    const item = settings.nodes.get('action-list').children[0];
    const button = item.children[0].children[0];
    assert.equal(button.title, '⚠画像が枠からはみ出しています');
    assert.equal(button.children[1].children[0].children[0].textContent, ' ⚠');

    assert.equal(settings.api.fitActionIntoFrame(clipped), true);
    assert.equal(settings.api.computeClipping(fullFrame(), clipped.imageTransform).clipped, false);
    assert.deepEqual(
      JSON.parse(JSON.stringify(untouched.imageTransform)),
      { scale: 0.6, offsetX: 0, offsetY: 0 },
    );
    assert.equal(settings.api.state.dirty, true);
    assert.equal(settings.nodes.get('toast').textContent, '枠に収めました。');

    settings.api.state.selectedId = nearEdge._uiId;
    settings.api.renderActionList();
    settings.api.renderEditor();
    assert.equal(settings.api.elements.actionClippingStatus.textContent, '見切れなし');
    assert.equal(settings.api.elements.actionFitInFrame.hidden, true);
    const nearEdgeItem = settings.nodes.get('action-list').children[1];
    assert.equal(nearEdgeItem.children[0].children[0].title, 'near-edge');
    assert.equal(nearEdgeItem.children[0].children[1].children[0].children.length, 0);
    assert.deepEqual(
      JSON.parse(JSON.stringify(nearEdge.imageTransform)),
      { scale: 1, offsetX: 0, offsetY: 0 },
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(untouched.imageTransform)),
      { scale: 0.6, offsetX: 0, offsetY: 0 },
    );
  });
});

test('size comparison cards fix clipped images only and alignment is capped at 92%', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const savedPayloads = [];
    const settings = loadSettingsForTest({
      projectRoot,
      mascotAPI: {
        saveConfig: async (config) => {
          savedPayloads.push(config);
          return { ok: true, applied: true, config };
        },
      },
    });
    const clipped = createAction('clipped', { scale: 1.2, offsetX: 0, offsetY: 10 });
    const nearEdge = createAction('near-edge');
    const clear = createAction('clear', { scale: 0.6, offsetX: 0, offsetY: 0 });
    configureSettings(settings, [clipped, nearEdge, clear]);
    await prepareMeasurements(settings, [
      [clipped, fullFrame()],
      [nearEdge, fullFrame(0.5, 0.5, 0.26, 0.5)],
      [clear, fullFrame()],
    ]);

    await openSizeManager(settings);
    const elements = settings.api.elements;
    assert.equal(elements.sizeManagerFitClipped.disabled, false);
    assert.equal(elements.sizeManagerGrid.children[0].children[3].hidden, false);
    assert.equal(elements.sizeManagerGrid.children[0].children[3].textContent, '⚠画像が枠からはみ出しています');
    assert.equal(elements.sizeManagerGrid.children[1].children[3].hidden, true);
    assert.equal(elements.sizeManagerGrid.children[2].children[3].hidden, true);
    elements.sizeManagerFitClipped.onclick();
    assert.equal(elements.sizeManagerStatus.textContent, '1 枚の画像を枠に収めました。');
    assert.equal(elements.sizeManagerGrid.children[0].children[3].hidden, true);
    assert.equal(elements.sizeManagerGrid.children[1].children[3].hidden, true);
    await elements.sizeManagerSave.onclick();
    assert.equal(settings.api.computeClipping(fullFrame(), clipped.imageTransform).clipped, false);
    assert.deepEqual(
      JSON.parse(JSON.stringify(savedPayloads[0].actions[0].imageTransform)),
      JSON.parse(JSON.stringify(clipped.imageTransform)),
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(savedPayloads[0].actions[1].imageTransform)),
      { flipX: false, scale: 1, offsetX: 0, offsetY: 0 },
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(clear.imageTransform)),
      { flipX: false, scale: 0.6, offsetX: 0, offsetY: 0 },
    );

    const alignment = createAction('alignment');
    configureSettings(settings, [alignment]);
    await prepareMeasurements(settings, [[alignment, fullFrame()]]);
    await openSizeManager(settings);
    assert.equal(settings.api.elements.sizeManagerTargetSlider.max, '92');
    settings.api.elements.sizeManagerAuto.onclick();
    await settings.api.elements.sizeManagerSave.onclick();
    assert.equal(savedPayloads[1].actions[0].imageTransform.scale, 0.92);
    assert.equal(alignment.imageTransform.scale, 0.92);
    const alignmentStatus = settings.api.computeClipping(fullFrame(), alignment.imageTransform);
    assert.equal(alignmentStatus.clipped, false);
  });
});

test('trimming warning updates while adjusting without changing the saved transform', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    const action = createAction('trim');
    configureSettings(settings, [action]);
    await prepareMeasurements(settings, [[action, fullFrame()]]);
    settings.api.openImageEditor();

    settings.api.elements.imageScale.value = '1.23';
    settings.api.elements.imageScale.oninput();
    assert.equal(settings.api.elements.imageEditorClippingStatus.textContent, '⚠画像が枠からはみ出しています');
    assert.deepEqual(
      JSON.parse(JSON.stringify(action.imageTransform)),
      { scale: 1, offsetX: 0, offsetY: 0 },
    );

    settings.api.elements.imageScale.value = '1';
    settings.api.elements.imageScale.oninput();
    assert.equal(settings.api.elements.imageEditorClippingStatus.textContent, '見切れなし');
  });
});

test('image measurements are cached per asset and requested with at most four concurrent operations', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    let active = 0;
    let maximumActive = 0;
    const calls = [];
    class SuccessfulImage {
      constructor() {
        this.naturalWidth = 20;
        this.naturalHeight = 20;
      }
      set src(_value) { queueMicrotask(() => this.onload?.()); }
    }
    const actions = Array.from({ length: 7 }, (_, index) => createAction(`queue-${index}`));
    const settings = loadSettingsForTest({
      projectRoot,
      ImageClass: SuccessfulImage,
      mascotAPI: {
        getAssetMetadata: async (file) => {
          calls.push(file);
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { cacheKey: file };
        },
      },
    });
    configureSettings(settings, actions);
    settings.mascotAPI.getAssetMetadata = async (file) => {
      calls.push(file);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { cacheKey: file };
    };
    settings.api.requestVisibleContentMeasurements();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(calls.length, actions.length);
    assert.equal(new Set(calls).size, actions.length);
    assert.ok(maximumActive <= 4, `maximum concurrent measurements: ${maximumActive}`);

    settings.api.requestVisibleContentMeasurements();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls.length, actions.length);

    actions[0].file = 'actions/replaced.png';
    actions[0]._assetUrl = 'file://replaced.png';
    settings.api.requestVisibleContentMeasurements();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls.length, actions.length + 1);
    assert.ok(settings.api.actionMeasurements.has(actions[0]._uiId));
  });
});

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

test('clipping reports each overflowing edge and allows the 0.5% tolerance', async () => {
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
    assert.deepEqual(Array.from(tolerated.tight), ['left', 'right']);
  });
});

test('frame edges within 2% are tight, while 3% clearance is not', async () => {
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
    assert.deepEqual(Array.from(onePercent.tight), ['left']);
    assert.deepEqual(Array.from(threePercent.tight), []);
  });
});

test('fit scales to 92%, clears tight edges, and respects transform bounds', async () => {
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
    assert.deepEqual(Array.from(fittedStatus.tight), []);

    const touchingImage = fit(fullFrame(), { scale: 1, offsetX: 0, offsetY: 0 });
    assert.equal(touchingImage.scale, 0.92);
    assert.equal(touchingImage.offsetX, 0);
    assert.equal(touchingImage.offsetY, 0);
    const touchingStatus = settings.api.computeClipping(fullFrame(), touchingImage);
    assert.deepEqual(Array.from(touchingStatus.tight), []);
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

test('STEP 1 reports clipping, marks the action list, and fits only the selected image', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    const clipped = createAction('clipped', { scale: 1.23, offsetX: 10, offsetY: 0 });
    const tight = createAction('tight');
    const untouched = createAction('untouched', { scale: 0.6, offsetX: 0, offsetY: 0 });
    configureSettings(settings, [clipped, tight, untouched]);
    await prepareMeasurements(settings, [
      [clipped, fullFrame()],
      [tight, fullFrame(0.5, 0.5, 0.26, 0.5)],
      [untouched, fullFrame()],
    ]);

    settings.api.renderActionList();
    settings.api.renderEditor();
    assert.match(settings.api.elements.actionClippingStatus.textContent, /右.*切れています/);
    assert.equal(settings.api.elements.actionFitInFrame.hidden, false);
    const item = settings.nodes.get('action-list').children[0];
    const button = item.children[0].children[0];
    assert.equal(button.title, '画像が枠から見切れています');
    assert.equal(button.children[1].children[0].children[0].textContent, ' ⚠');

    assert.equal(settings.api.fitActionIntoFrame(clipped), true);
    assert.equal(settings.api.computeClipping(fullFrame(), clipped.imageTransform).clipped, false);
    assert.deepEqual(
      JSON.parse(JSON.stringify(untouched.imageTransform)),
      { scale: 0.6, offsetX: 0, offsetY: 0 },
    );
    assert.equal(settings.api.state.dirty, true);
    assert.equal(settings.nodes.get('toast').textContent, '枠に収めました。');

    settings.api.state.selectedId = tight._uiId;
    settings.api.renderActionList();
    settings.api.renderEditor();
    assert.equal(settings.api.elements.actionClippingStatus.textContent, '⚠ 左が枠にぎりぎりです');
    assert.equal(settings.api.elements.actionFitInFrame.hidden, false);
    const tightItem = settings.nodes.get('action-list').children[1];
    assert.equal(tightItem.children[0].children[0].title, '画像が枠にぎりぎりです');
    assert.equal(settings.api.fitActionIntoFrame(tight), true);
    const fixedTight = settings.api.computeClipping(fullFrame(0.5, 0.5, 0.26, 0.5), tight.imageTransform);
    assert.equal(fixedTight.clipped, false);
    assert.deepEqual(Array.from(fixedTight.tight), []);
    assert.deepEqual(
      JSON.parse(JSON.stringify(untouched.imageTransform)),
      { scale: 0.6, offsetX: 0, offsetY: 0 },
    );
  });
});

test('size comparison cards fix clipped and tight images only and alignment is capped at 92%', async () => {
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
    const tight = createAction('tight');
    const clear = createAction('clear', { scale: 0.6, offsetX: 0, offsetY: 0 });
    configureSettings(settings, [clipped, tight, clear]);
    await prepareMeasurements(settings, [
      [clipped, fullFrame()],
      [tight, fullFrame(0.5, 0.5, 0.26, 0.5)],
      [clear, fullFrame()],
    ]);

    await openSizeManager(settings);
    const elements = settings.api.elements;
    assert.equal(elements.sizeManagerFitClipped.disabled, false);
    assert.equal(elements.sizeManagerGrid.children[0].children[3].hidden, false);
    assert.equal(elements.sizeManagerGrid.children[1].children[3].textContent, '⚠ ぎりぎり');
    assert.equal(elements.sizeManagerGrid.children[1].children[3].hidden, false);
    assert.equal(elements.sizeManagerGrid.children[2].children[3].hidden, true);
    elements.sizeManagerFitClipped.onclick();
    assert.equal(elements.sizeManagerStatus.textContent, '2 枚の画像を枠に収めました。');
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
      JSON.parse(JSON.stringify(tight.imageTransform)),
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
    assert.deepEqual(Array.from(alignmentStatus.tight), []);
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
    assert.match(settings.api.elements.imageEditorClippingStatus.textContent, /上.*下.*切れています/);
    assert.match(settings.api.elements.imageEditorClippingStatus.textContent, /枠からはみ出した部分は、表示されません/);
    assert.deepEqual(
      JSON.parse(JSON.stringify(action.imageTransform)),
      { scale: 1, offsetX: 0, offsetY: 0 },
    );

    settings.api.elements.imageScale.value = '1';
    settings.api.elements.imageScale.oninput();
    assert.equal(settings.api.elements.imageEditorClippingStatus.textContent, '⚠ 上・下・左・右が枠にぎりぎりです');
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

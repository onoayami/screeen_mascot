import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadSettingsForTest } from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

function configureAction(settings, imageTransform = { scale: 1.5, offsetX: 0, offsetY: 0 }) {
  settings.api.state.config = {
    name: '画像位置の確認',
    mascot: { size: 180, startPosition: 'center', margin: 40, rememberPosition: false },
  };
  settings.api.state.actions = [{
    _uiId: 'wide-image-action',
    name: '横長画像',
    file: 'actions/wide.svg',
    weight: 1,
    durationMs: [6000, 10000],
    flipMode: 'none',
    imageTransform: { ...imageTransform },
    movement: { type: 'still', speed: 0 },
    _assetUrl: 'data:image/svg+xml,wide-image',
  }];
  settings.api.state.selectedId = 'wide-image-action';
  settings.api.state.dirty = false;
  settings.api.renderActionList();
}

function pointerEvent(type, properties) {
  return {
    type,
    pointerId: 1,
    button: 0,
    isPrimary: true,
    preventDefault() {},
    ...properties,
  };
}

function drag(frame, start, end) {
  frame.dispatchEvent(pointerEvent('pointerdown', { clientX: start.x, clientY: start.y }));
  frame.dispatchEvent(pointerEvent('pointermove', { clientX: end.x, clientY: end.y }));
  frame.dispatchEvent(pointerEvent('pointerup', { clientX: end.x, clientY: end.y }));
}

test('image editor dragging updates the position sliders and clamps offsets', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    configureAction(settings);
    settings.api.elements.imageEditorFrame.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400,
    });
    settings.nodes.get('image-edit-button').dispatchEvent({ type: 'click' });

    drag(settings.api.elements.imageEditorFrame, { x: 100, y: 100 }, { x: 140, y: 60 });
    assert.equal(settings.api.elements.imageOffsetX.value, '10');
    assert.equal(settings.api.elements.imageOffsetY.value, '-10');
    assert.equal(settings.api.elements.imageOffsetXOutput.textContent, '+10');
    assert.equal(settings.api.elements.imageOffsetYOutput.textContent, '-10');

    drag(settings.api.elements.imageEditorFrame, { x: 100, y: 100 }, { x: 1100, y: -900 });
    assert.equal(settings.api.elements.imageOffsetX.value, '100');
    assert.equal(settings.api.elements.imageOffsetY.value, '-100');
    assert.equal(settings.api.elements.imageEditorFrame.classList.contains('is-dragging'), false);
  });
});

test('size manager dragging updates working offsets without disrupting the scale slider', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    let resolveMetadata;
    const metadata = new Promise((resolve) => { resolveMetadata = resolve; });
    const savedPayloads = [];
    const settings = loadSettingsForTest({
      projectRoot,
      mascotAPI: {
        getAssetMetadata: () => metadata,
        saveConfig: async (config) => {
          savedPayloads.push(config);
          return { ok: true, applied: true, config };
        },
      },
    });
    configureAction(settings);
    settings.nodes.get('open-size-manager').dispatchEvent({ type: 'click' });

    const card = settings.api.elements.sizeManagerGrid.children[0];
    const preview = card.children[1];
    preview.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400,
    });
    drag(preview, { x: 100, y: 100 }, { x: 140, y: 60 });
    assert.match(card.children[2].children[2].textContent, /横 \+10%・縦 -10%/);

    const slider = card.children[2].children.find((child) => child.type === 'range');
    assert.ok(slider);
    slider.value = '1.75';
    slider.dispatchEvent({ type: 'input' });
    await settings.api.elements.sizeManagerSave.onclick();

    assert.deepEqual(
      {
        scale: settings.api.state.actions[0].imageTransform.scale,
        offsetX: settings.api.state.actions[0].imageTransform.offsetX,
        offsetY: settings.api.state.actions[0].imageTransform.offsetY,
      },
      { scale: 1.75, offsetX: 10, offsetY: -10 },
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(savedPayloads[0].actions[0].imageTransform)),
      { flipX: false, scale: 1.75, offsetX: 10, offsetY: -10 },
    );
    resolveMetadata({ cacheKey: 'late-measurement' });
    await new Promise((resolve) => setImmediate(resolve));
  });
});

test('action preview image is nested inside a square preview frame', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const html = fs.readFileSync(path.join(projectRoot, 'settings.html'), 'utf8');
    const css = fs.readFileSync(path.join(projectRoot, 'settings.css'), 'utf8');
    const dropzone = html.match(/<button id="action-dropzone"[\s\S]*?<\/button>/)?.[0];

    assert.ok(dropzone);
    assert.match(
      dropzone,
      /<span id="action-preview-frame" class="dropzone-preview-frame" hidden>\s*<img id="action-preview"/,
    );
    assert.match(css, /\.dropzone-preview-frame\s*\{[^}]*aspect-ratio:\s*1;/);
    assert.match(css, /\.dropzone-preview-frame\s*\{[^}]*overflow:\s*hidden;/);
    assert.match(css, /\.image-editor-preview,\s*\.size-card-preview\s*\{[^}]*touch-action:\s*none;/);
  });
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadSettingsForTest } from '../phase0/helpers/loaders.mjs';
import { PROJECT_ROOT } from '../phase0/helpers/workspace.mjs';

function setup(size = 128, effect) {
  const settings = loadSettingsForTest({ projectRoot: PROJECT_ROOT });
  settings.window.screen = { availWidth: 1400, availHeight: 1100 };
  settings.window.getComputedStyle = (element) => element.testPadding || {};
  const action = {
    _uiId: 'preview', name: 'Preview', file: 'actions/preview.gif',
    _assetUrl: 'data:image/gif;base64,preview',
    imageTransform: { flipX: false, scale: 1, offsetX: 0, offsetY: 0 },
    weight: 1, durationMs: [6000, 10000], movement: { type: 'still', speed: 0 },
    ...(effect ? { effect } : {}),
  };
  Object.assign(settings.api.state, {
    config: { mascot: { size } }, actions: [action], selectedId: action._uiId, dirty: false,
  });
  settings.api.sizeMeasurementCache.set(`${action._assetUrl}|0:0`, {
    promise: Promise.resolve({ baseWidth: 1, baseHeight: 1, centerX: 0.5, centerY: 0.5 }),
    expiresAt: Date.now() + 60_000,
  });
  for (const element of [
    settings.api.elements.actionDropzone, settings.api.elements.imageEditorStage,
    settings.api.elements.effectLivePreview,
  ]) {
    element.clientWidth = 300;
    element.clientHeight = 300;
  }
  settings.api.elements.imageControlStack.clientWidth = 300;
  settings.api.renderEditor();
  return { ...settings, action, elements: settings.api.elements };
}

function click(element) {
  element.dispatchEvent({ type: 'click' });
}

test('front-direction marker stays outside the clipped frame and is hidden without an image', () => {
  const { api, action, elements } = setup();
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'settings.html'), 'utf8');
  const css = fs.readFileSync(path.join(PROJECT_ROOT, 'settings.css'), 'utf8');
  const dropzone = html.match(/<button id="action-dropzone"[\s\S]*?<\/button>/)?.[0];
  const frame = dropzone?.match(/<span id="action-preview-frame"[\s\S]*?<\/span>/)?.[0];
  const marker = dropzone?.match(/<span id="action-preview-marker"[\s\S]*?<\/span>/)?.[0];
  assert.ok(frame);
  assert.ok(marker);
  assert.ok(dropzone.indexOf(marker) > dropzone.indexOf(frame));
  assert.doesNotMatch(frame, /front-direction-marker/);
  assert.match(css, /\.front-direction-marker\s*\{[^}]*position:\s*absolute;[^}]*white-space:\s*nowrap;/);
  assert.match(css, /#action-dropzone\.has-image\s*\{[^}]*border-width:\s*2px;[^}]*padding:\s*36px 20px 16px;/);
  assert.match(css, /\.front-direction-marker\s*\{[^}]*top:\s*7px;[^}]*white-space:\s*nowrap;/);
  assert.doesNotMatch(css, /#action-dropzone\.has-image \.front-direction-marker/);
  assert.match(css, /#action-dropzone\s*\{\s*height:\s*260px;/);
  assert.match(css, /#action-dropzone\.has-image\s*\{[^}]*width:\s*fit-content;[^}]*height:\s*auto;[^}]*min-height:\s*0;/);
  assert.match(css, /\.preview-toolbar\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/);
  assert.match(css, /\.preview-toolbar \.secondary-button\s*\{[^}]*min-height:\s*36px;/);
  assert.equal(elements.actionDropzone.classList.contains('has-image'), true);
  assert.equal(elements.actionPreviewMarker.hidden, false);
  action._assetUrl = null;
  api.renderEditor();
  assert.equal(elements.actionDropzone.classList.contains('has-image'), false);
  assert.equal(elements.actionPreviewMarker.hidden, true);
});

test('ordinary previews never enlarge; the main preview uses stable parent capacity', () => {
  const { api, elements, window } = setup();
  elements.mascotSize.value = '32';
  elements.mascotSize.dispatchEvent({ type: 'input' });
  assert.equal(elements.actionPreviewFrame.style.width, '32px');
  elements.mascotSize.value = '128';
  elements.mascotSize.dispatchEvent({ type: 'input' });
  assert.equal(elements.actionPreviewFrame.style.width, '128px');
  assert.match(elements.actionPreviewScale.textContent, /実寸 100%/);
  assert.equal(api.previewFitRatio(600, 600, 300, 300), 0.5);
  assert.equal(api.previewFitRatio(128, 128, 300, 300), 1);
  elements.mascotSize.value = '139';
  elements.mascotSize.dispatchEvent({ type: 'input' });
  assert.equal(elements.actionPreviewFrame.style.width, '139px');
  elements.actionDropzone.clientWidth = 1;
  api.refreshPreviewGeometry();
  assert.equal(elements.actionPreviewFrame.style.width, '139px');
  elements.mascotSize.value = '600';
  elements.mascotSize.dispatchEvent({ type: 'input' });
  assert.equal(elements.actionPreviewFrame.style.width, '216px');
  assert.match(elements.actionPreviewScale.textContent, /縮小表示 36%/);
  elements.imageControlStack.clientWidth = 244;
  window.dispatch('resize');
  assert.equal(elements.actionPreviewFrame.style.width, '200px');
  assert.match(elements.actionPreviewScale.textContent, /縮小表示 33.3%/);
  elements.imageControlStack.testPadding = { paddingLeft: '20px', paddingRight: '20px' };
  window.dispatch('resize');
  assert.equal(elements.actionPreviewFrame.style.width, '160px');
  elements.imageControlStack.clientWidth = 0;
  api.refreshPreviewGeometry();
  assert.equal(elements.actionPreviewScale.textContent, 'プレビューを配置中…');
});

test('zero-sized preview containers do not retain stale scale labels', () => {
  const { api, elements } = setup(128, {
    _assetUrl: 'data:image/png;base64,effect', size: 40, offsetX: 0, offsetY: 0,
  });
  elements.imageControlStack.clientWidth = 0;
  elements.effectLivePreview.clientWidth = 0;
  api.refreshPreviewGeometry();
  assert.equal(elements.actionPreviewScale.textContent, 'プレビューを配置中…');
  assert.equal(elements.effectPreviewScale.textContent, 'プレビューを配置中…');
  elements.imageControlStack.clientWidth = 300;
  elements.effectLivePreview.clientWidth = 300;
  api.refreshPreviewGeometry();
  assert.match(elements.actionPreviewScale.textContent, /実寸 100%/);
  assert.match(elements.effectPreviewScale.textContent, /実寸 100%/);
});

test('actual-size dialog stays at 100%, reads unsaved size, and never saves on close', () => {
  const { api, action, elements, window } = setup(600);
  action.imageTransform = { flipX: true, scale: 1.5, offsetX: 20, offsetY: -10 };
  click(elements.actionActualSize);
  assert.equal(elements.actualSizeMascot.style.width, '600px');
  assert.equal(elements.actualSizeScene.style.width, '600px');
  assert.equal(elements.actualSizeImage.style.transform, 'translate(20%, -10%) scaleX(-1) scale(1.5)');
  assert.match(elements.actualSizeScale.textContent, /実寸 100%/);
  elements.actionDropzone.clientWidth = 50;
  window.dispatch('resize');
  assert.equal(elements.actualSizeMascot.style.width, '600px');
  click(elements.actualSizeClose);
  assert.equal(elements.actualSizeDialog.open, false);
  assert.equal(api.state.dirty, false);
  assert.equal(api.state.config.mascot.size, 600);
});

test('screen clamp is shared with actual-size preview and distinguishes configured/effective sizes', () => {
  const { elements, window } = setup(1000);
  window.screen = { availWidth: 800, availHeight: 600 };
  window.dispatch('resize');
  click(elements.actionActualSize);
  assert.equal(elements.actualSizeMascot.style.width, '576px');
  assert.match(elements.actualSizeScale.textContent, /設定 1000px → 画面上限 576px/);
  assert.match(elements.actionPreviewScale.textContent, /縮小表示 37.5%/);
  click(elements.actualSizeClose);
});

test('trim actual-size uses working flip/scale/pan; editing magnification and cancel do not commit', () => {
  const { api, action, elements } = setup(128);
  const original = JSON.stringify(action.imageTransform);
  api.openImageEditor();
  assert.equal(elements.imageEditorFrame.style.width, '128px');
  elements.imageScale.value = '2';
  elements.imageOffsetX.value = '25';
  elements.imageOffsetY.value = '-15';
  elements.imageEditorFlipX.checked = true;
  elements.imageScale.oninput();
  elements.imageEditorMagnify.checked = true;
  elements.imageEditorMagnify.onchange();
  assert.equal(elements.imageEditorFrame.style.width, '300px');
  assert.match(elements.imageEditorPreviewScale.textContent, /編集用拡大 234.4%/);
  elements.imageEditorActualSize.onclick();
  assert.equal(elements.actualSizeMascot.style.width, '128px');
  assert.equal(elements.actualSizeImage.style.transform, 'translate(25%, -15%) scaleX(-1) scale(2)');
  click(elements.actualSizeClose);
  assert.equal(elements.imageEditorDialog.open, true);
  elements.imageEditorCancel.onclick();
  assert.equal(JSON.stringify(action.imageTransform), original);
  assert.equal(api.state.dirty, false);
  api.openImageEditor();
  assert.equal(elements.imageEditorMagnify.checked, false);
  assert.equal(elements.imageEditorFrame.style.width, '128px');
  elements.imageEditorCancel.onclick();
});

test('size cards preserve child ordering and show staged size/transform in actual dialog without committing', () => {
  const { api, action, elements, window } = setup(128);
  click(elements.openSizeManager);
  const card = elements.sizeManagerGrid.children[0];
  const preview = card.children[1];
  const slider = card.children[2].children[1];
  const previewToolbar = card.children[4];
  const previewLabel = previewToolbar.children[0];
  const actualSizeButton = previewToolbar.children[1];
  assert.equal(previewToolbar.className, 'size-card-preview-toolbar');
  card.clientWidth = 300;
  api.refreshPreviewGeometry();
  assert.equal(preview.style.width, '128px');
  elements.sizeManagerMascotSize.value = '600';
  elements.sizeManagerMascotSize.oninput();
  slider.value = '1.75';
  slider.dispatchEvent({ type: 'input' });
  assert.equal(preview.style.width, '300px');
  assert.match(previewLabel.textContent, /縮小表示 50%/);
  click(actualSizeButton);
  assert.equal(elements.actualSizeMascot.style.width, '600px');
  assert.equal(elements.actualSizeImage.style.transform, 'translate(0%, 0%) scale(1.75)');
  click(elements.actualSizeClose);
  card.clientWidth = 240;
  window.dispatch('resize');
  assert.equal(preview.style.width, '240px');
  assert.match(previewLabel.textContent, /縮小表示 40%/);
  elements.sizeManagerCancel.onclick();
  assert.equal(api.state.config.mascot.size, 128);
  assert.equal(action.imageTransform.scale, 1);
  assert.equal(api.state.dirty, false);
});

test('effect union fits negative offsets and tall aspect ratio uniformly; actual view scrolls entire union', () => {
  const effect = { _assetUrl: 'data:image/png;base64,effect', size: 200, offsetX: -300, offsetY: 400 };
  const { elements } = setup(128, effect);
  elements.effectLiveImage.naturalWidth = 100;
  elements.effectLiveImage.naturalHeight = 400;
  elements.effectLiveImage.dispatchEvent({ type: 'load' });
  assert.equal(elements.effectLiveMascot.style.width, '48px');
  assert.equal(elements.effectLiveImage.style.width, '75px');
  assert.match(elements.effectPreviewScale.textContent, /縮小表示 37.5%/);
  elements.actualSizeEffect.naturalWidth = 100;
  elements.actualSizeEffect.naturalHeight = 100;
  click(elements.effectActualSize);
  assert.equal(elements.actualSizeScene.style.width, '464px');
  assert.equal(elements.actualSizeScene.style.height, '500px');
  elements.actualSizeEffect.naturalHeight = 400;
  elements.actualSizeEffect.dispatchEvent({ type: 'load' });
  assert.equal(elements.actualSizeScene.style.height, '800px');
  assert.equal(elements.actualSizeMascot.style.width, '128px');
  assert.equal(elements.actualSizeMascot.style.left, '336px');
  assert.equal(elements.actualSizeMascot.style.top, '672px');
  assert.equal(elements.actualSizeEffect.style.width, '200px');
  assert.equal(elements.actualSizeEffect.style.left, '100px');
  assert.equal(elements.actualSizeEffect.style.top, '400px');
  click(elements.actualSizeClose);
  elements.effectOffsetX.value = '20';
  elements.effectOffsetX.dispatchEvent({ type: 'input' });
  click(elements.effectActualSize);
  assert.equal(elements.actualSizeEffect.style.left, '100px');
  assert.equal(elements.actualSizeScene.style.width, '200px');
  click(elements.actualSizeClose);
});

test('small effect mascot is not forced to 48px; runtime clamp does not scale effect px values', () => {
  const effect = { _assetUrl: 'data:image/png;base64,effect', size: 20, offsetX: 0, offsetY: 10 };
  const { api, elements, window } = setup(32, effect);
  assert.equal(elements.effectLiveMascot.style.width, '32px');
  assert.equal(elements.effectLiveImage.style.width, '20px');
  assert.match(elements.effectPreviewScale.textContent, /実寸 100%/);
  api.state.config.mascot.size = 1000;
  window.screen = { availWidth: 800, availHeight: 600 };
  click(elements.effectActualSize);
  assert.equal(elements.actualSizeMascot.style.width, '576px');
  assert.equal(elements.actualSizeEffect.style.width, '20px');
  assert.equal(elements.actualSizeEffect.style.top, '566px');
  click(elements.actualSizeClose);
});

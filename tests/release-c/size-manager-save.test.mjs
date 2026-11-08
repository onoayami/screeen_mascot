import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadSettingsForTest } from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

class LoadingImage {
  constructor() {
    this.naturalWidth = 100;
    this.naturalHeight = 100;
  }

  set src(value) {
    this._src = value;
    queueMicrotask(() => this.onload?.());
  }

  get src() {
    return this._src;
  }
}

function openSizeManager(settings) {
  const { api, nodes } = settings;
  api.state.config = {
    name: 'サイズ確認',
    mascot: { size: 180, startPosition: 'bottom-right', margin: 40, rememberPosition: true },
  };
  api.state.actions = [{
    _uiId: 'size-action',
    name: '休む',
    file: 'actions/rest.svg',
    weight: 1,
    durationMs: [5000, 9000],
    movement: { type: 'still', speed: 0 },
    imageTransform: { scale: 1, offsetX: 0, offsetY: 0 },
    _assetUrl: 'file:///actions/rest.svg',
  }];
  api.state.selectedId = 'size-action';
  nodes.get('open-size-manager').dispatchEvent({ type: 'click' });
}

function setSizeScale(elements, scale) {
  const controls = elements.sizeManagerGrid.children[0].children[2];
  const slider = controls.children.find((child) => child.type === 'range');
  assert.ok(slider, 'size manager slider should be rendered');
  slider.value = String(scale);
  slider.dispatchEvent({ type: 'input' });
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

test('size manager save applies the working transform and saves once before measurement completes', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const metadata = deferred();
    const savedPayloads = [];
    const html = fs.readFileSync(path.join(projectRoot, 'settings.html'), 'utf8');
    const settings = loadSettingsForTest({
      projectRoot,
      ImageClass: LoadingImage,
      mascotAPI: {
        getAssetMetadata: () => metadata.promise,
        saveConfig: async (config) => {
          savedPayloads.push(config);
          return { ok: true, applied: true, config };
        },
      },
    });

    openSizeManager(settings);
    const sizeManagerDialog = html.match(/<dialog id="size-manager-dialog"[\s\S]*?<\/dialog>/)?.[0];
    const sizeManagerActions = sizeManagerDialog?.match(/<footer class="jpeg-dialog-actions">([\s\S]*?)<\/footer>/)?.[1];
    assert.ok(sizeManagerActions);
    assert.equal((sizeManagerActions.match(/<button\b/g) || []).length, 2);
    assert.match(sizeManagerActions, /id="size-manager-cancel"/);
    assert.match(sizeManagerActions, /id="size-manager-save"[^>]*>保存して反映/);
    setSizeScale(settings.api.elements, 1.75);
    await settings.api.elements.sizeManagerSave.onclick();

    assert.equal(savedPayloads.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(savedPayloads[0].actions[0].imageTransform)), {
      flipX: false,
      scale: 1.75,
      offsetX: 0,
      offsetY: 0,
    });
    assert.equal(settings.api.elements.sizeManagerDialog.open, false);
    assert.match(settings.api.elements.toast.textContent, /設定を保存し/);

    metadata.resolve({ cacheKey: 'late-measurement' });
    await new Promise((resolve) => setImmediate(resolve));
  });
});

test('size manager save failure leaves the transform applied as an unsaved change', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const metadata = deferred();
    let saveCalls = 0;
    const settings = loadSettingsForTest({
      projectRoot,
      mascotAPI: {
        getAssetMetadata: () => metadata.promise,
        saveConfig: async () => {
          saveCalls += 1;
          return { ok: false };
        },
      },
    });

    openSizeManager(settings);
    setSizeScale(settings.api.elements, 1.4);
    await settings.api.elements.sizeManagerSave.onclick();

    assert.equal(saveCalls, 1);
    assert.equal(settings.api.state.actions[0].imageTransform.scale, 1.4);
    assert.equal(settings.api.state.dirty, true);
    assert.match(settings.api.elements.feedback.textContent, /保存に失敗しました/);
    assert.equal(settings.api.elements.sizeManagerDialog.open, false);

    metadata.resolve({ cacheKey: 'late-measurement' });
    await new Promise((resolve) => setImmediate(resolve));
  });
});

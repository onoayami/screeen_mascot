import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRendererForTest } from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

test('retry after the first configuration load failure uses configured start position', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    let loadCount = 0;
    const config = {
      name: '開始位置の再確認',
      mascot: { size: 180, startPosition: 'top-right', margin: 40, rememberPosition: false },
      actions: [{
        name: '休む',
        file: 'actions/rest.svg',
        weight: 1,
        durationMs: [6000, 10000],
        movement: { type: 'still', speed: 0 },
      }],
    };
    class LoadedImage {
      constructor() {
        this.naturalWidth = 1;
        this.naturalHeight = 1;
      }

      set src(value) {
        this.source = value;
        queueMicrotask(() => this.onload?.());
      }
    }
    const renderer = loadRendererForTest({
      projectRoot,
      ImageClass: LoadedImage,
      mascotAPI: {
        async loadConfig() {
          loadCount += 1;
          if (loadCount === 1) throw new Error('initial load failed');
          return { config };
        },
        async resolveAsset() { return 'file:///test/rest.svg'; },
      },
    });
    const mascotImage = renderer.nodes.get('mascot-image');
    let mascotImageSource = '';
    Object.defineProperty(mascotImage, 'src', {
      get() { return mascotImageSource; },
      set(value) {
        mascotImageSource = value;
        queueMicrotask(() => mascotImage.dispatchEvent({ type: 'load' }));
      },
    });

    const first = await renderer.api.reloadConfig({ keepPosition: false });
    assert.equal(first.ok, false);
    assert.equal(renderer.api.state.currentAction, null);

    const retry = await renderer.api.reloadConfig({ keepPosition: true });
    assert.equal(retry.ok, true);
    assert.equal(renderer.api.state.position.x, 580);
    assert.equal(renderer.api.state.position.y, 40);

    renderer.api.state.position = { x: 300, y: 250 };
    const normalReload = await renderer.api.reloadConfig({ keepPosition: true });
    assert.equal(normalReload.ok, true);
    assert.equal(renderer.api.state.position.x, 300);
    assert.equal(renderer.api.state.position.y, 250);
  });
});

test('renderer degrades only for unavailable assets and keeps saved-hash verification strict', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const config = {
      name: '画像欠落時の縮退',
      mascot: { size: 180, startPosition: 'center', margin: 40, rememberPosition: false },
      actions: [
        {
          name: '表示可能',
          file: 'actions/available.svg',
          weight: 1,
          durationMs: [6000, 10000],
          movement: { type: 'still', speed: 0 },
        },
        {
          name: '画像欠落',
          file: 'actions/missing.svg',
          weight: 1,
          durationMs: [6000, 10000],
          movement: { type: 'still', speed: 0 },
        },
      ],
    };
    class LoadedImage {
      constructor() {
        this.naturalWidth = 1;
        this.naturalHeight = 1;
      }

      set src(_value) {
        queueMicrotask(() => this.onload?.());
      }
    }
    const renderer = loadRendererForTest({
      projectRoot,
      ImageClass: LoadedImage,
      mascotAPI: {
        async loadConfig() {
          return { config, configHash: 'saved-hash' };
        },
        async resolveAsset(relativePath) {
          if (relativePath.endsWith('missing.svg')) return null;
          return 'file:///test/available.svg';
        },
      },
    });
    const mascotImage = renderer.nodes.get('mascot-image');
    let mascotImageSource = '';
    Object.defineProperty(mascotImage, 'src', {
      get() { return mascotImageSource; },
      set(value) {
        mascotImageSource = value;
        queueMicrotask(() => mascotImage.dispatchEvent({ type: 'load' }));
      },
    });

    const degraded = await renderer.api.reloadConfig();
    assert.equal(degraded.ok, true);
    assert.deepEqual(Array.from(renderer.api.state.actions, (action) => action.name), ['表示可能']);
    assert.deepEqual(Array.from(renderer.api.state.unavailableActionNames), ['画像欠落']);
    assert.match(renderer.nodes.get('status').textContent, /画像欠落/);

    const verifiedApply = await renderer.api.reloadConfig({ expectedConfigHash: 'saved-hash' });
    assert.equal(verifiedApply.ok, false);
    assert.equal(renderer.api.state.actions.length, 1);
    assert.match(verifiedApply.error, /画像が見つかりません/);

    const brokenConfig = { ...config, actions: [config.actions[0]] };
    const ipcFailure = loadRendererForTest({
      projectRoot,
      mascotAPI: {
        loadConfig: async () => ({ config: brokenConfig }),
        resolveAsset: async () => { throw new Error('IPC failure'); },
      },
    });
    const rejected = await ipcFailure.api.reloadConfig();
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /IPC failure/);
    assert.equal(ipcFailure.api.state.actions.length, 0);

    const contentInvalid = loadRendererForTest({
      projectRoot,
      ImageClass: LoadedImage,
      mascotAPI: {
        loadConfig: async () => ({
          config: brokenConfig,
          configHash: 'saved-hash',
          assetsIncomplete: true,
        }),
        resolveAsset: async () => 'file:///test/content-invalid.svg',
      },
    });
    const contentImage = contentInvalid.nodes.get('mascot-image');
    Object.defineProperty(contentImage, 'src', {
      set(value) {
        contentImage.assetUrl = value;
        queueMicrotask(() => contentImage.dispatchEvent({ type: 'load' }));
      },
    });
    const partialContent = await contentInvalid.api.reloadConfig();
    assert.equal(partialContent.ok, true);
    assert.equal(partialContent.partial, true);
    assert.equal(partialContent.appliedHash, null);
    assert.match(contentInvalid.nodes.get('status').textContent, /画像の確認が必要/);

    const strictContent = await contentInvalid.api.reloadConfig({ expectedConfigHash: 'saved-hash' });
    assert.equal(strictContent.ok, false);
    assert.match(strictContent.error, /画像をすべて表示できません/);
  });
});

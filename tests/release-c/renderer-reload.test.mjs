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

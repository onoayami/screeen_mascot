import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRendererForTest } from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

test('mascot hit testing matches inclusive box boundaries without reading layout', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot, width: 800, height: 600 });
    renderer.api.state.config = { mascot: { size: 100 } };
    renderer.api.state.position = { x: 100, y: 120 };
    renderer.nodes.get('mascot').getBoundingClientRect = () => {
      throw new Error('hit testing must not force layout');
    };

    const cases = [
      [100, 120, true],
      [150, 170, true],
      [200, 220, true],
      [99.99, 120, false],
      [200.01, 170, false],
      [150, 220.01, false],
    ];
    for (const [x, y, expected] of cases) {
      assert.equal(renderer.api.pointIsInsideMascot(x, y), expected, `(${x}, ${y})`);
    }
  });
});

test('documentElement mouseleave restores passthrough while paused', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot });
    const documentElement = renderer.context.document.documentElement;
    renderer.api.state.pointerPosition = { x: 100, y: 100 };
    renderer.api.state.passthrough = false;
    renderer.api.state.paused = true;

    documentElement.dispatchEvent({ type: 'mouseleave' });

    assert.equal(renderer.api.state.pointerPosition, null);
    assert.equal(renderer.api.state.passthrough, true);
    assert.equal(renderer.passthroughCalls.at(-1), true);
    assert.equal(renderer.window._listeners.has('mouseleave'), false);
  });
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  readJson,
  recursiveManifest,
  runConfigCheck,
  withTemporaryProject,
  writeJson,
} from './helpers/workspace.mjs';
import {
  loadMainForTest,
  loadRendererForTest,
  loadSettingsForTest,
} from './helpers/loaders.mjs';

const knownDefect = (id) => ({ todo: `${id}: v2.3.4で再現済み。修正後にTODOを外す。` });

function seededRandom(seed = 0x12345678) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function combinedOutput(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function installTrustedWindow(main, projectRoot, role, senderOverrides = {}) {
  const fileName = role === 'settings' ? 'settings.html' : 'index.html';
  const senderFrame = { url: pathToFileURL(path.join(projectRoot, fileName)).href };
  const sender = {
    id: role === 'settings' ? 41 : 42,
    isDestroyed: () => false,
    ...senderOverrides,
    mainFrame: senderFrame,
  };
  const window = { isDestroyed: () => false, webContents: sender };
  if (role === 'settings') main.api.setSettingsWindow(window);
  else main.api.setMascotWindow(window);
  return { sender, senderFrame };
}

test('T01: external symlink assets are rejected', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters, temporaryRoot }) => {
    const outside = path.join(temporaryRoot, 'outside.png');
    fs.writeFileSync(outside, 'not an image');
    const link = path.join(userCharacters, 'actions', 'external-link.png');
    fs.symlinkSync(outside, link);
    const { api } = loadMainForTest({ projectRoot, userDataRoot });
    assert.equal(api.resolveCharacterPath('actions/external-link.png'), null);
  });
});

test('T02: an asset path cannot point to a directory', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const config = readJson(path.join(userCharacters, 'config.json'));
    config.actions[0].file = 'actions';
    const { api } = loadMainForTest({ projectRoot, userDataRoot });
    assert.throws(() => api.validateAndNormalizeConfig(config), /画像|ファイル/);
  });
});

test('T03: null previewActionIndex remains unspecified instead of becoming index 0', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const main = loadMainForTest({ projectRoot, userDataRoot });
    const sentCommands = [];
    const mascotEvent = installTrustedWindow(main, projectRoot, 'mascot', {
      id: 73,
      isLoading: () => false,
      send(channel, payload) {
        sentCommands.push({ channel, payload });
        if (channel === 'mascot:command' && payload?.command === 'reload-config') {
          queueMicrotask(() => main.ipcListeners.get('mascot:apply-result')(
            mascotEvent,
            { requestId: payload.value.requestId, ok: true, actionName: '休む' },
          ));
        }
      },
    });
    const settingsEvent = installTrustedWindow(main, projectRoot, 'settings');
    const config = readJson(path.join(userCharacters, 'config.json'));
    await main.handlers.get('mascot:save-config')(
      settingsEvent,
      { config, previewActionIndex: null },
    );
    const reload = sentCommands.find((entry) => entry.payload?.command === 'reload-config');
    assert.equal(reload.payload.value.previewActionIndex, null);
  });
});

test('T04: oversized mascots use an effective size that fits the viewport inset', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot, width: 800, height: 600 });
    renderer.api.state.config = { mascot: { size: 1000, margin: 12 } };
    assert.ok(renderer.api.getMascotWidth() <= 576);
    const bounds = renderer.api.movementBounds();
    assert.ok(bounds.minX >= 12 && bounds.minY >= 12);
  });
});

test('T05: two-action weighted selection follows an approximate 10:1 ratio', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot, random: seededRandom() });
    const heavy = { name: 'heavy', weight: 10 };
    const light = { name: 'light', weight: 1 };
    renderer.api.state.actions = [heavy, light];
    renderer.api.state.currentAction = null;
    const counts = new Map([[heavy, 0], [light, 0]]);
    for (let index = 0; index < 10000; index += 1) {
      const selected = renderer.api.chooseWeightedAction();
      counts.set(selected, counts.get(selected) + 1);
      renderer.api.state.currentAction = selected;
    }
    const ratio = counts.get(heavy) / counts.get(light);
    assert.ok(ratio > 8 && ratio < 12, `actual ratio: ${ratio}`);
  });
});

test('T06: horizontal movement treats margin 0 as zero extra margin', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot, width: 800, height: 600 });
    const action = {
      name: 'walk', assetUrl: 'file://walk.svg', weight: 1,
      durationMs: [5000, 5000], movement: { type: 'horizontal', speed: 55 },
    };
    renderer.api.state.config = { mascot: { size: 180, margin: 0 } };
    renderer.api.state.position = { x: 100, y: 100 };
    renderer.api.setAction(action, 0);
    assert.equal(renderer.api.state.position.y, renderer.api.movementBounds().maxY);
  });
});

test('T07: failed size measurements are removed from cache and retried', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    let imageCreations = 0;
    class FailingImage {
      constructor() { imageCreations += 1; }
      set src(_value) { queueMicrotask(() => this.onerror?.()); }
    }
    const settings = loadSettingsForTest({ projectRoot, ImageClass: FailingImage });
    await assert.rejects(settings.api.measureVisibleContent('file://broken.png'));
    await assert.rejects(settings.api.measureVisibleContent('file://broken.png'));
    assert.equal(imageCreations, 2);
  });
});

test('T08: localStorage write failures do not escape savePosition', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const storage = {
      getItem: () => null,
      setItem() { throw new Error('storage unavailable'); },
    };
    const renderer = loadRendererForTest({ projectRoot, localStorage: storage });
    renderer.api.state.config = { mascot: { rememberPosition: true, size: 180 } };
    assert.doesNotThrow(() => renderer.api.savePosition());
  });
});

test('T10: build check rejects invalid ranges and directory assets', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    writeJson(path.join(projectRoot, 'characters', 'default', 'config.json'), {
      name: 'invalid',
      mascot: { size: -1, margin: -1 },
      actions: [{
        name: 'invalid action', file: 'actions', weight: 1,
        durationMs: [-1000, -2000], movement: { type: 'horizontal', speed: -99 },
      }],
    });
    const result = runConfigCheck(projectRoot);
    assert.notEqual(result.status, 0, combinedOutput(result));
  });
});

test('T11: build check reports actions[0] null without a TypeError stack', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    writeJson(path.join(projectRoot, 'characters', 'default', 'config.json'), { actions: [null] });
    const result = runConfigCheck(projectRoot);
    const output = combinedOutput(result);
    assert.notEqual(result.status, 0);
    assert.match(output, /actions\[0\]/);
    assert.doesNotMatch(output, /TypeError/);
  });
});

test('T12: build check reports a null root config without a TypeError stack', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    writeJson(path.join(projectRoot, 'characters', 'default', 'config.json'), null);
    const result = runConfigCheck(projectRoot);
    const output = combinedOutput(result);
    assert.notEqual(result.status, 0);
    assert.match(output, /設定|config\.json/);
    assert.doesNotMatch(output, /TypeError/);
  });
});

test('T13: loading settings from disk does not claim runtime apply success', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    let saveCalls = 0;
    const settings = loadSettingsForTest({
      projectRoot,
      mascotAPI: {
        saveConfig: async (config) => { saveCalls += 1; return { ok: true, applied: true, config }; },
      },
    });
    await settings.api.loadConfiguration();
    assert.equal(saveCalls, 0);
    assert.notEqual(settings.nodes.get('save-state').textContent, '保存済み');
    assert.doesNotMatch(settings.nodes.get('feedback').textContent, /反映されています/);
  });
});

test('T14: configured top-left start position preserves margin 0', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot, width: 800, height: 600 });
    renderer.api.state.config = { mascot: { size: 180, margin: 0, startPosition: 'top-left' } };
    const start = renderer.api.configuredStartPosition();
    assert.equal(start.x, 0);
    assert.equal(start.y, 0);
  });
});

test('T15: movement re-evaluates passthrough for a stationary pointer', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot, width: 800, height: 600 });
    renderer.api.state.config = { mascot: { size: 100, margin: 0 } };
    renderer.api.state.position = { x: 0, y: 0 };
    renderer.api.state.currentAction = {
      name: 'move', movement: { type: 'horizontal', speed: 100 }, durationMs: [999999, 999999],
    };
    renderer.api.state.velocity = { x: 100, y: 0 };
    renderer.api.state.nextActionAt = Number.POSITIVE_INFINITY;
    renderer.window.dispatch('pointermove', { pointerId: 1, clientX: 50, clientY: 50 });
    renderer.passthroughCalls.length = 0;
    renderer.api.updateMotion(1000, 1);
    assert.ok(renderer.passthroughCalls.includes(true));
  });
});

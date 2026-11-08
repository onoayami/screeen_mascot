import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  loadMainForTest,
  loadRendererForTest,
  loadSettingsForTest,
} from '../phase0/helpers/loaders.mjs';
import {
  readJson,
  withTemporaryProject,
  writeJson,
} from '../phase0/helpers/workspace.mjs';

function installTrustedWindow(main, projectRoot, role, senderOverrides = {}) {
  const fileName = role === 'settings' ? 'settings.html' : 'index.html';
  const senderFrame = { url: pathToFileURL(path.join(projectRoot, fileName)).href };
  const sender = {
    id: role === 'settings' ? 401 : 402,
    isDestroyed: () => false,
    isLoading: () => false,
    ...senderOverrides,
    mainFrame: senderFrame,
  };
  const window = { isDestroyed: () => false, webContents: sender };
  if (role === 'settings') main.api.setSettingsWindow(window);
  else main.api.setMascotWindow(window);
  return { sender, senderFrame };
}

function eventForWindow(window) {
  return {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('B-01: editable loading preserves missing assets while strict runtime loading rejects them', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const configPath = path.join(userCharacters, 'config.json');
    const config = readJson(configPath);
    config.actions[0].file = 'actions/missing-image.png';
    writeJson(configPath, config);

    const main = loadMainForTest({ projectRoot, userDataRoot });
    assert.throws(() => main.api.loadNormalizedConfig(), /missing-image|画像|ファイル/);
    assert.equal(typeof main.api.loadEditableConfig, 'function');

    const editable = main.api.loadEditableConfig();
    assert.equal(editable.config.actions[0].file, 'actions/missing-image.png');
    assert.ok(editable.warnings.some((warning) => /missing-image|画像/.test(warning)));
    assert.deepEqual([...editable.missingAssets], ['actions/missing-image.png']);
  });
});

test('B-02: invalid JSON enters recovery mode without overwriting the original file', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const configPath = path.join(userCharacters, 'config.json');
    const broken = '{ "name": "broken", '; 
    fs.writeFileSync(configPath, broken, 'utf8');

    const main = loadMainForTest({ projectRoot, userDataRoot });
    assert.equal(typeof main.api.loadEditableConfig, 'function');
    const editable = main.api.loadEditableConfig();

    assert.equal(editable.config, null);
    assert.equal(editable.recovery.kind, 'invalid-json');
    assert.equal(fs.readFileSync(configPath, 'utf8'), broken);
    assert.equal(editable.recovery.canInitialize, true);
  });
});

test('B-03: save and apply succeed only with one matching SHA-256', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const main = loadMainForTest({ projectRoot, userDataRoot });
    let command = null;
    let mascotEvent;
    mascotEvent = installTrustedWindow(main, projectRoot, 'mascot', {
      id: 503,
      send(channel, payload) {
        if (channel !== 'mascot:command' || payload?.command !== 'reload-config') return;
        command = payload;
        queueMicrotask(() => main.ipcListeners.get('mascot:apply-result')(
          mascotEvent,
          {
            requestId: payload.value.requestId,
            ok: true,
            appliedHash: payload.value.configHash,
            actionName: '休む',
          },
        ));
      },
    });
    const settingsEvent = installTrustedWindow(main, projectRoot, 'settings');
    const config = readJson(path.join(userCharacters, 'config.json'));

    const result = await main.handlers.get('mascot:save-config')(
      settingsEvent,
      { config, previewActionIndex: 0 },
    );

    assert.match(result.savedHash, /^[a-f0-9]{64}$/);
    assert.equal(result.appliedHash, result.savedHash);
    assert.equal(result.applied, true);
    assert.equal(command.value.configHash, result.savedHash);
  });
});

test('B-04: a mismatched renderer hash cannot be reported as applied', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const main = loadMainForTest({ projectRoot, userDataRoot });
    let mascotEvent;
    mascotEvent = installTrustedWindow(main, projectRoot, 'mascot', {
      id: 504,
      send(channel, payload) {
        if (channel !== 'mascot:command' || payload?.command !== 'reload-config') return;
        queueMicrotask(() => main.ipcListeners.get('mascot:apply-result')(
          mascotEvent,
          {
            requestId: payload.value.requestId,
            ok: true,
            appliedHash: '0'.repeat(64),
          },
        ));
      },
    });
    const settingsEvent = installTrustedWindow(main, projectRoot, 'settings');
    const config = readJson(path.join(userCharacters, 'config.json'));

    const result = await main.handlers.get('mascot:save-config')(
      settingsEvent,
      { config, previewActionIndex: 0 },
    );

    assert.equal(result.applied, false);
    assert.match(result.applyError, /ハッシュ|一致|別の設定/);
  });
});

test('B-13: save retries once when a tray reload supersedes its apply', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const main = loadMainForTest({ projectRoot, userDataRoot });
    const config = readJson(path.join(userCharacters, 'config.json'));
    const normalizedConfig = main.api.validateAndNormalizeConfig(config);
    const configHash = main.api.hashNormalizedConfig(normalizedConfig);
    let loadCount = 0;
    let releaseFirstLoad;
    let applyAttempts = 0;
    let trayReloadResult = null;
    let supersededApplyResult = null;
    let simulationError = null;
    let mascotEvent;

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
          if (loadCount === 1) {
            return new Promise((resolve) => {
              releaseFirstLoad = resolve;
            });
          }
          return { config, configHash };
        },
        async resolveAsset() {
          return 'file:///test/rest.svg';
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

    mascotEvent = installTrustedWindow(main, projectRoot, 'mascot', {
      id: 513,
      send(channel, payload) {
        if (channel !== 'mascot:command' || payload?.command !== 'reload-config') return;
        applyAttempts += 1;

        const reportResult = (result) => main.ipcListeners.get('mascot:apply-result')(
          mascotEvent,
          { requestId: payload.value.requestId, ...result },
        );

        if (applyAttempts === 1) {
          const saveReload = renderer.api.reloadConfig({
            keepPosition: true,
            preferredActionIndex: payload.value.previewActionIndex,
            expectedConfigHash: payload.value.configHash,
          });
          const trayReload = renderer.api.reloadConfig({ keepPosition: true });

          void (async () => {
            try {
              trayReloadResult = await trayReload;
              releaseFirstLoad({ config, configHash });
              supersededApplyResult = await saveReload;
              reportResult(supersededApplyResult);
            } catch (error) {
              simulationError = error;
              reportResult({ ok: false, error: error.message });
            }
          })();
          return;
        }

        void renderer.api.reloadConfig({
          keepPosition: true,
          preferredActionIndex: payload.value.previewActionIndex,
          expectedConfigHash: payload.value.configHash,
        }).then(reportResult, (error) => {
          simulationError = error;
          reportResult({ ok: false, error: error.message });
        });
      },
    });
    const settingsEvent = installTrustedWindow(main, projectRoot, 'settings');
    const result = await main.handlers.get('mascot:save-config')(
      settingsEvent,
      { config, previewActionIndex: 0 },
    );

    assert.equal(simulationError, null);
    assert.equal(trayReloadResult?.ok, true);
    assert.equal(supersededApplyResult?.superseded, true);
    assert.equal(applyAttempts, 2);
    assert.equal(result.applied, true);
    assert.equal(result.appliedHash, result.savedHash);
  });
});

test('B-05: renderer creation re-sends the paused state after did-finish-load', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const main = loadMainForTest({ projectRoot, userDataRoot });
    main.api.createMascotWindow();
    const window = main.browserWindows.at(-1);
    main.api.setPaused(true);
    window.webContents.sent.length = 0;

    window.webContents.emit('did-finish-load');

    assert.ok(window.webContents.sent.some(({ channel, payload }) => (
      channel === 'mascot:command'
      && payload?.command === 'set-paused'
      && payload?.value === true
    )));
  });
});

test('B-06: recalling to center restores a hidden mascot window', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    let workArea = { x: 0, y: 0, width: 800, height: 600 };
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      screenOverrides: {
        getAllDisplays: () => [{ workArea }],
        getDisplayNearestPoint: () => ({ workArea }),
      },
    });
    main.api.createMascotWindow();
    const window = main.browserWindows.at(-1);
    workArea = { x: 1000, y: 0, width: 800, height: 600 };
    window.hide();
    window.webContents.sent.length = 0;

    assert.equal(typeof main.api.recallMascotToCenter, 'function');
    main.api.recallMascotToCenter();

    assert.equal(window.isVisible(), true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(window.webContents.sent.some(({ payload }) => payload?.command === 'center'));
  });
});

test('B-07: main-process cursor synchronization sends window-local coordinates', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      screenOverrides: {
        getCursorScreenPoint: () => ({ x: 125, y: 75 }),
        getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 800, height: 600 } }),
        getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 800, height: 600 } }],
      },
    });
    main.api.createMascotWindow();
    const window = main.browserWindows.at(-1);
    window.webContents.sent.length = 0;

    assert.equal(typeof main.api.synchronizeMascotPassthrough, 'function');
    main.api.synchronizeMascotPassthrough();

    const sync = window.webContents.sent.find(({ payload }) => payload?.command === 'sync-pointer-position');
    assert.deepEqual({ ...sync.payload.value }, { x: 125, y: 75 });
  });
});

test('B-08: stale operation completion cannot clear a newer busy operation', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    assert.equal(typeof settings.api.beginOperation, 'function');
    assert.equal(typeof settings.api.endOperation, 'function');

    const first = settings.api.beginOperation('first');
    assert.ok(first);
    assert.equal(settings.api.state.busy, true);
    settings.api.endOperation(first);
    assert.equal(settings.api.state.busy, false);

    const second = settings.api.beginOperation('second');
    assert.ok(second);
    settings.api.endOperation(first);
    assert.equal(settings.api.state.busy, true);
    settings.api.endOperation(second);
    assert.equal(settings.api.state.busy, false);
  });
});

test('B-09: settings serialization rejects out-of-range and reversed values without clamping', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    settings.api.state.config = {
      name: 'Range test',
      mascot: { size: 180, startPosition: 'bottom-right', margin: 40, rememberPosition: true },
    };
    settings.api.state.actions = [{
      _uiId: 'action-1',
      name: 'walk',
      file: 'actions/rest.svg',
      weight: 1,
      durationMs: [5000, 9000],
      flipMode: 'direction',
      imageTransform: { scale: 1, offsetX: 0, offsetY: 0 },
      movement: { type: 'horizontal', speed: 2001 },
    }];
    settings.api.state.selectedId = 'action-1';

    assert.throws(() => settings.api.serializeConfig(), /0.*2000|速さ|speed/);
    settings.api.state.actions[0].movement.speed = 55;
    settings.api.state.actions[0].durationMs = [9000, 5000];
    assert.throws(() => settings.api.serializeConfig(), /最短|最長|duration/);
  });
});

test('B-10: applied display waits for the actual mascot image load and rejects image errors', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot });
    assert.equal(typeof renderer.api.displayAction, 'function');
    renderer.api.state.config = { name: 'Display test', mascot: { size: 100, margin: 0 } };
    const action = {
      name: 'rest',
      assetUrl: 'file://rest.svg',
      weight: 1,
      durationMs: [5000, 5000],
      movement: { type: 'still', speed: 0 },
    };

    let settled = false;
    const displayed = renderer.api.displayAction(action, 0, 1000).then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    renderer.nodes.get('mascot-image').dispatchEvent({ type: 'load' });
    await displayed;
    assert.equal(settled, true);

    const failed = renderer.api.displayAction({ ...action, assetUrl: 'file://broken.svg' }, 0, 1000);
    const rejection = assert.rejects(failed, /表示|画像/);
    await Promise.resolve();
    renderer.nodes.get('mascot-image').dispatchEvent({ type: 'error' });
    await rejection;
  });
});

test('B-11: settings HTML uses the shared mascot size and movement speed ranges', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const html = fs.readFileSync(path.join(projectRoot, 'settings.html'), 'utf8');
    const mascotSize = html.match(/<input id="mascot-size"[^>]*>/)?.[0] || '';
    const movementSpeed = html.match(/<input id="movement-speed"[^>]*>/)?.[0] || '';
    assert.match(mascotSize, /min="32"/);
    assert.match(mascotSize, /max="1000"/);
    assert.match(movementSpeed, /min="0"/);
    assert.match(movementSpeed, /max="2000"/);
  });
});

test('B-12: dirty settings require an explicit edit-or-discard close choice', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    let response = 0;
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      dialogOverrides: {
        async showMessageBox() { return { response }; },
      },
    });
    main.api.openSettingsWindow();
    const window = main.browserWindows.at(-1);
    const dirtyListener = main.ipcListeners.get('mascot:settings-dirty');
    assert.equal(typeof dirtyListener, 'function');
    dirtyListener(eventForWindow(window), true);

    assert.equal(window.close(), false);
    await nextTurn();
    assert.equal(window.isDestroyed(), false);

    response = 1;
    assert.equal(window.close(), false);
    await nextTurn();
    await nextTurn();
    assert.equal(window.isDestroyed(), true);
  });
});

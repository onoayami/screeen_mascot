import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadMainForTest, loadSettingsForTest } from '../phase0/helpers/loaders.mjs';
import { PROJECT_ROOT } from '../phase0/helpers/workspace.mjs';

const svg = (color) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="${color}"/></svg>`,
);

class LoadingImage {
  constructor() {
    this.naturalWidth = 100;
    this.naturalHeight = 100;
  }

  set src(value) {
    this._src = value;
    queueMicrotask(() => this.onload?.());
  }

  get src() { return this._src; }
}

async function withUserData(callback, overrides = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'duplicate-action-'));
  const userDataRoot = path.join(root, 'Desktop Mascot');
  let main = null;
  try {
    main = loadMainForTest({ projectRoot: PROJECT_ROOT, userDataRoot, ...overrides });
    const characterRoot = main.api.ensureCharacterDirectory();
    return await callback({ main, characterRoot, root, userDataRoot });
  } finally {
    if (main?.api.flushDiagnostics) await main.api.flushDiagnostics();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeInternalSources(characterRoot, { shared = false } = {}) {
  const mainBytes = svg('#f35');
  const effectBytes = shared ? mainBytes : svg('#35f');
  const mainPath = path.join(characterRoot, 'actions', shared ? 'same.svg' : 'source.svg');
  const effectPath = path.join(characterRoot, 'effects', shared ? 'same.svg' : 'effect.svg');
  fs.writeFileSync(mainPath, mainBytes);
  if (shared) fs.linkSync(mainPath, effectPath);
  else fs.writeFileSync(effectPath, effectBytes);
  return { mainPath, effectPath, mainBytes, effectBytes };
}

function actionConfig(count = 2) {
  return {
    name: '複製テスト',
    mascot: { size: 180, startPosition: 'bottom-right', margin: 40, rememberPosition: true },
    actions: Array.from({ length: count }, (_, index) => ({
      name: `動作${index + 1}`,
      file: `actions/source-${index + 1}.svg`,
      weight: index + 1,
      durationMs: [6000 + index * 1000, 10000 + index * 1000],
      flipMode: 'random',
      imageTransform: { flipX: index === 0, scale: 1.4, offsetX: 7, offsetY: -3 },
      movement: { type: 'horizontal', speed: 73 },
      effect: {
        file: `effects/effect-${index + 1}.svg`,
        intervalMs: 370,
        size: 44,
        lifetimeMs: 1620,
        offsetX: -5,
        offsetY: 19,
        coordinateVersion: 2,
        emitWhileStill: true,
      },
    })),
  };
}

function createSettings(config, api = {}) {
  const settings = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    mascotAPI: {
      loadConfig: async () => ({ config: structuredClone(config) }),
      ...api,
    },
  });
  return settings.api.loadConfiguration().then(() => settings);
}

test('duplicate assets are independent byte copies with collision-safe paths for both roles', async () => {
  await withUserData(async ({ main, characterRoot }) => {
    const { mainPath, effectPath, mainBytes, effectBytes } = writeInternalSources(
      characterRoot,
      { shared: true },
    );
    const existing = path.join(characterRoot, 'actions', 'same-copy.svg');
    fs.writeFileSync(existing, svg('#abc'));

    const copies = main.api.duplicateActionAssets({
      mainPath: 'actions/same.svg',
      effectPath: 'effects/same.svg',
    });
    const copiedMain = path.join(characterRoot, copies.main.relativePath);
    const copiedEffect = path.join(characterRoot, copies.effect.relativePath);
    assert.equal(copies.main.relativePath, 'actions/same-copy-2.svg');
    assert.equal(copies.effect.relativePath, 'effects/same-copy.svg');
    assert.deepEqual(fs.readFileSync(copiedMain), mainBytes);
    assert.deepEqual(fs.readFileSync(copiedEffect), effectBytes);
    assert.notEqual(fs.statSync(copiedMain).ino, fs.statSync(mainPath).ino);
    assert.notEqual(fs.statSync(copiedEffect).ino, fs.statSync(effectPath).ino);
    assert.deepEqual(fs.readFileSync(mainPath), mainBytes);
    assert.deepEqual(fs.readFileSync(effectPath), effectBytes);
  });
});

test('duplicate assets retain supported source extensions and exact bytes', async () => {
  const fixtures = new Map([
    ['.gif', Buffer.from('GIF89a', 'ascii')],
    ['.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['.webp', Buffer.from([
      0x52, 0x49, 0x46, 0x46, 17, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0, 0x2f, 0, 0, 0, 0,
    ])],
    ['.svg', svg('#789')],
    ['.jpg', Buffer.from([0xff, 0xd8, 0xff])],
    ['.jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x01])],
  ]);
  await withUserData(async ({ main, characterRoot }) => {
    for (const [extension, bytes] of fixtures) {
      const base = `source${extension}`;
      const mainPath = path.join(characterRoot, 'actions', base);
      const effectPath = path.join(characterRoot, 'effects', base);
      fs.writeFileSync(mainPath, bytes);
      fs.writeFileSync(effectPath, bytes);
      const copies = main.api.duplicateActionAssets({
        mainPath: `actions/${base}`,
        effectPath: `effects/${base}`,
      });
      assert.equal(path.extname(copies.main.relativePath), extension);
      assert.equal(path.extname(copies.effect.relativePath), extension);
      assert.deepEqual(fs.readFileSync(path.join(characterRoot, copies.main.relativePath)), bytes);
      assert.deepEqual(fs.readFileSync(path.join(characterRoot, copies.effect.relativePath)), bytes);
    }
  });
});

test('duplicate asset validation rejects traversal, symlinks, and untrusted IPC senders', async () => {
  await withUserData(async ({ main, characterRoot, userDataRoot }) => {
    const { mainPath } = writeInternalSources(characterRoot);
    const outside = path.join(userDataRoot, 'outside.svg');
    fs.writeFileSync(outside, svg('#000'));
    fs.symlinkSync(outside, path.join(characterRoot, 'actions', 'linked.svg'));
    assert.throws(
      () => main.api.duplicateActionAssets({ mainPath: '../outside.svg' }),
      /外を指しています|相対パス/,
    );
    assert.throws(
      () => main.api.duplicateActionAssets({ mainPath: 'actions/linked.svg' }),
      /シンボリックリンク/,
    );
    assert.throws(
      () => main.api.duplicateActionAssets({
        mainPath: 'actions/source.svg',
        effectPath: 'actions/source.svg',
      }),
      /保存先/,
    );

    main.api.createMascotWindow();
    main.api.openSettingsWindow();
    const mascotWindow = main.browserWindows.find((window) => window.options.transparent);
    const settingsWindow = main.browserWindows.find((window) => window.options.title === 'マスコット設定');
    const event = (window) => ({
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame,
    });
    const duplicate = main.handlers.get('mascot:duplicate-action-assets');
    await assert.rejects(
      () => duplicate(event(mascotWindow), { mainPath: 'actions/source.svg' }),
      /許可されていません/,
    );
    const result = await duplicate(event(settingsWindow), { mainPath: 'actions/source.svg' });
    assert.match(result.main.relativePath, /^actions\/source-copy(?:-\d+)?\.svg$/);
    assert.ok(fs.existsSync(mainPath));
  });
});

test('a failure copying the second role rolls back all new files and preserves sources', async () => {
  let shouldFail = false;
  let copyCount = 0;
  const fsOverrides = {
    copyFileSync(source, destination, ...args) {
      if (shouldFail && ++copyCount === 2) throw new Error('injected second-copy failure');
      return fs.copyFileSync(source, destination, ...args);
    },
  };
  await withUserData(async ({ main, characterRoot }) => {
    const { mainBytes, effectBytes } = writeInternalSources(characterRoot);
    const beforeActions = fs.readdirSync(path.join(characterRoot, 'actions')).sort();
    const beforeEffects = fs.readdirSync(path.join(characterRoot, 'effects')).sort();
    shouldFail = true;
    assert.throws(
      () => main.api.duplicateActionAssets({
        mainPath: 'actions/source.svg',
        effectPath: 'effects/effect.svg',
      }),
      /injected second-copy failure/,
    );
    assert.deepEqual(fs.readdirSync(path.join(characterRoot, 'actions')).sort(), beforeActions);
    assert.deepEqual(fs.readdirSync(path.join(characterRoot, 'effects')).sort(), beforeEffects);
    assert.deepEqual(fs.readFileSync(path.join(characterRoot, 'actions', 'source.svg')), mainBytes);
    assert.deepEqual(fs.readFileSync(path.join(characterRoot, 'effects', 'effect.svg')), effectBytes);
  }, { fsOverrides });
});

test('saved configuration references prevent duplicate cleanup; unreferenced copies can be removed', async () => {
  await withUserData(async ({ main, characterRoot }) => {
    writeInternalSources(characterRoot);
    const copies = main.api.duplicateActionAssets({ mainPath: 'actions/source.svg' });
    const configPath = path.join(characterRoot, 'config.json');
    const originalConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    originalConfig.actions[0].file = copies.main.relativePath;
    fs.writeFileSync(configPath, JSON.stringify(originalConfig));

    assert.equal(main.api.discardImportedImage(copies.main.relativePath, 'actions'), false);
    assert.equal(fs.existsSync(path.join(characterRoot, copies.main.relativePath)), true);

    originalConfig.actions[0].file = 'actions/rest.svg';
    fs.writeFileSync(configPath, JSON.stringify(originalConfig));
    assert.equal(main.api.discardImportedImage(copies.main.relativePath, 'actions'), true);
    assert.equal(fs.existsSync(path.join(characterRoot, copies.main.relativePath)), false);
  });
});

test('a successfully saved duplicate keeps its image after the action is later removed and saved', async () => {
  await withUserData(async ({ main, characterRoot }) => {
    writeInternalSources(characterRoot);
    const copies = main.api.duplicateActionAssets({ mainPath: 'actions/source.svg' });
    const configPath = path.join(characterRoot, 'config.json');
    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    savedConfig.actions[0].file = copies.main.relativePath;
    main.api.writeConfigAtomic(savedConfig);

    const deletedConfig = structuredClone(savedConfig);
    deletedConfig.actions.shift();
    main.api.writeConfigAtomic(deletedConfig);
    main.api.cleanupSessionDuplicatedImages();

    assert.equal(fs.existsSync(path.join(characterRoot, copies.main.relativePath)), true);
  });
});

test('duplicate cleanup safely preserves copies when saved configuration cannot be read', async () => {
  await withUserData(async ({ main, characterRoot }) => {
    assert.equal(main.api.cleanupSessionDuplicatedImages(), 0);
    writeInternalSources(characterRoot);
    const copies = main.api.duplicateActionAssets({ mainPath: 'actions/source.svg' });
    fs.writeFileSync(path.join(characterRoot, 'config.json'), '{broken json');
    assert.doesNotThrow(() => main.api.cleanupSessionDuplicatedImages());
    assert.equal(fs.existsSync(path.join(characterRoot, copies.main.relativePath)), true);
  });
});

test('closing settings keeps pending copies when discard is cancelled and cleans them after confirmation', async () => {
  let response = 0;
  await withUserData(async ({ main, characterRoot }) => {
    writeInternalSources(characterRoot);
    const copies = main.api.duplicateActionAssets({ mainPath: 'actions/source.svg' });
    main.api.createMascotWindow();
    main.api.openSettingsWindow();
    const settingsWindow = main.browserWindows.find((window) => window.options.title === 'マスコット設定');
    const event = {
      sender: settingsWindow.webContents,
      senderFrame: settingsWindow.webContents.mainFrame,
    };
    main.ipcListeners.get('mascot:settings-dirty')(event, true);

    settingsWindow.close();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      fs.existsSync(path.join(characterRoot, copies.main.relativePath)),
      true,
    );

    response = 1;
    settingsWindow.close();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      fs.existsSync(path.join(characterRoot, copies.main.relativePath)),
      false,
    );
  }, {
    dialogOverrides: {
      async showMessageBox() { return { response }; },
    },
  });
});

test('duplicate selected action deep-clones settings, inserts after source, stays unsaved, and selected-save preserves order', async () => {
  const config = actionConfig();
  const payloads = [];
  const calls = [];
  const settings = await createSettings(config, {
    duplicateActionAssets: async (mainPath, effectPath) => {
      calls.push({ mainPath, effectPath });
      return {
        main: { relativePath: 'actions/copied.svg', assetUrl: 'file:///actions/copied.svg' },
        effect: { relativePath: 'effects/copied.svg', assetUrl: 'file:///effects/copied.svg' },
      };
    },
    saveConfig: async (payload, previewIndex) => {
      payloads.push({ payload: structuredClone(payload), previewIndex });
      return { ok: true, applied: true, config: payload };
    },
  });
  const [source, other] = settings.api.state.actions;
  settings.api.state.config.mascot.size = 223;
  other.weight = 9;
  settings.api.markDirty();

  assert.equal(await settings.api.duplicateSelectedAction(), true);
  const duplicate = settings.api.state.actions[1];
  assert.equal(settings.api.state.actions[0], source);
  assert.equal(settings.api.state.actions[2], other);
  assert.equal(duplicate._uiId === source._uiId, false);
  assert.equal(settings.api.state.selectedId, duplicate._uiId);
  assert.equal(duplicate.name, `${source.name} のコピー`);
  assert.deepEqual(calls, [{ mainPath: source.file, effectPath: source.effect.file }]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(duplicate.imageTransform)),
    JSON.parse(JSON.stringify(source.imageTransform)),
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(duplicate.movement)),
    JSON.parse(JSON.stringify(source.movement)),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(duplicate.effect)), {
    ...JSON.parse(JSON.stringify(source.effect)),
    file: 'effects/copied.svg',
    _assetUrl: 'file:///effects/copied.svg',
  });
  assert.notEqual(duplicate.imageTransform, source.imageTransform);
  assert.notEqual(duplicate.movement, source.movement);
  assert.notEqual(duplicate.effect, source.effect);
  assert.equal(duplicate.file, 'actions/copied.svg');
  assert.equal(source.file, 'actions/source-1.svg');
  assert.equal(settings.api.state.dirty, true);

  assert.equal(await settings.api.saveSelectedAction(), true);
  assert.deepEqual(payloads[0].payload.actions.map((action) => action.name), [
    '動作1',
    `${source.name} のコピー`,
    '動作2',
  ]);
  assert.equal(payloads[0].previewIndex, 1);
  assert.equal(payloads[0].payload.mascot.size, config.mascot.size);
  assert.equal(settings.api.state.config.mascot.size, 223);
});

test('duplicate controls honor the maximum and busy state, while copy failures leave actions untouched', async () => {
  const maxConfig = actionConfig(100);
  let apiCalls = 0;
  const atMaximum = await createSettings(maxConfig, {
    duplicateActionAssets: async () => { apiCalls += 1; return null; },
  });
  assert.equal(atMaximum.nodes.get('duplicate-action').disabled, true);
  assert.equal(await atMaximum.api.duplicateSelectedAction(), false);
  assert.equal(apiCalls, 0);

  const settings = await createSettings(actionConfig(2), {
    duplicateActionAssets: async () => {
      apiCalls += 1;
      throw new Error('copy failed');
    },
  });
  const before = structuredClone(settings.api.state.actions);
  settings.api.setBusy(true);
  assert.equal(settings.nodes.get('duplicate-action').disabled, true);
  assert.equal(await settings.api.duplicateSelectedAction(), false);
  settings.api.setBusy(false);
  assert.equal(await settings.api.duplicateSelectedAction(), false);
  assert.equal(apiCalls, 1);
  assert.equal(settings.api.state.actions.length, before.length);
  assert.equal(settings.api.state.actions[0].name, before[0].name);
  assert.equal(settings.api.state.dirty, false);
});

test('deleting and confirmed reload clean unreferenced pending duplicate files', async () => {
  const discarded = [];
  const config = actionConfig(1);
  const settings = await createSettings(config, {
    duplicateActionAssets: async () => ({
      main: { relativePath: 'actions/pending.svg', assetUrl: 'file:///actions/pending.svg' },
      effect: { relativePath: 'effects/pending.svg', assetUrl: 'file:///effects/pending.svg' },
    }),
    discardImportedImage: async (relativePath, category, protectedPaths) => {
      discarded.push({ relativePath, category, protectedPaths });
      return true;
    },
  });
  assert.equal(await settings.api.duplicateSelectedAction(), true);
  settings.window.confirm = () => true;
  settings.api.elements.deleteAction.dispatchEvent({ type: 'click' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(discarded.map((entry) => entry.relativePath).sort(), [
    'actions/pending.svg',
    'effects/pending.svg',
  ]);

  discarded.length = 0;
  assert.equal(await settings.api.duplicateSelectedAction(), true);
  await settings.api.loadConfiguration();
  assert.deepEqual(discarded.map((entry) => entry.relativePath).sort(), [
    'actions/pending.svg',
    'effects/pending.svg',
  ]);
  assert.equal(settings.api.state.actions.length, 1);
});

test('replacing either duplicate image cleans only the now-unreferenced copied file', async () => {
  const discarded = [];
  const settings = await createSettings(actionConfig(1), {
    duplicateActionAssets: async () => ({
      main: { relativePath: 'actions/pending.svg', assetUrl: 'file:///actions/pending.svg' },
      effect: { relativePath: 'effects/pending.svg', assetUrl: 'file:///effects/pending.svg' },
    }),
    discardImportedImage: async (relativePath, category, protectedPaths) => {
      discarded.push({ relativePath, category, protectedPaths });
      return true;
    },
  });
  assert.equal(await settings.api.duplicateSelectedAction(), true);
  const duplicate = settings.api.state.actions[1];
  settings.api.applyImportedActionImage(
    { relativePath: 'actions/replacement.svg', assetUrl: 'file:///actions/replacement.svg' },
    duplicate._uiId,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(discarded.map((entry) => entry.relativePath), ['actions/pending.svg']);

  settings.api.applyImportedEffectImage(
    { relativePath: 'effects/replacement.svg', assetUrl: 'file:///effects/replacement.svg' },
    duplicate._uiId,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(discarded.map((entry) => entry.relativePath), [
    'actions/pending.svg',
    'effects/pending.svg',
  ]);
  assert.equal(duplicate._duplicatedAssetPaths.length, 0);
});

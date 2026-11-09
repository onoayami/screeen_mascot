import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSettingsForTest } from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

function action(name, file) {
  return {
    name,
    file,
    weight: 1,
    durationMs: [6000, 10000],
    movement: { type: 'still', speed: 0 },
  };
}

function config() {
  return {
    name: 'ドロップ画像のテスト',
    mascot: { size: 180, startPosition: 'bottom-right', margin: 40, rememberPosition: true },
    actions: [
      action('元の選択', 'actions/first.png'),
      action('後から選択', 'actions/second.png'),
    ],
  };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

class LoadedImage {
  constructor() {
    this.naturalWidth = 1;
    this.naturalHeight = 1;
  }

  set src(_value) {
    queueMicrotask(() => this.onload?.());
  }
}

test('drop imports keep the action selected before async token registration completes', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    let resolveToken;
    let resolveImport;
    let reportImportStarted;
    const tokenPromise = new Promise((resolve) => { resolveToken = resolve; });
    const importResult = new Promise((resolve) => { resolveImport = resolve; });
    const importStarted = new Promise((resolve) => { reportImportStarted = resolve; });
    const settings = loadSettingsForTest({
      projectRoot,
      ImageClass: LoadedImage,
      mascotAPI: {
        loadConfig: async () => ({ config: config() }),
        getPathForFile: () => tokenPromise,
        importImage: async (token, category) => {
          reportImportStarted({ token, category });
          return importResult;
        },
      },
    });
    await settings.api.loadConfiguration();
    const [original, newlySelected] = settings.api.state.actions;
    settings.api.state.selectedId = original._uiId;

    settings.api.elements.actionDropzone.dispatchEvent({
      type: 'drop',
      preventDefault() {},
      stopPropagation() {},
      dataTransfer: { files: [{}] },
    });
    settings.api.state.selectedId = newlySelected._uiId;
    resolveToken('drop:one-use-token');
    assert.deepEqual(await importStarted, {
      token: 'drop:one-use-token',
      category: 'actions',
    });
    resolveImport({
      relativePath: 'actions/imported.png',
      assetUrl: 'file:///actions/imported.png',
      isJpeg: false,
    });
    await nextTurn();

    assert.equal(original.file, 'actions/imported.png');
    assert.equal(newlySelected.file, 'actions/second.png');
  });
});

test('drop token registration rejection is logged and shown as an image-location error', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const errors = [];
    const testConsole = new Proxy(console, {
      get(target, property) {
        if (property === 'error') return (...args) => errors.push(args);
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const settings = loadSettingsForTest({
      projectRoot,
      ImageClass: LoadedImage,
      consoleObject: testConsole,
      mascotAPI: {
        loadConfig: async () => ({ config: config() }),
        getPathForFile: async () => { throw new Error('registration failed'); },
      },
    });
    await settings.api.loadConfiguration();
    settings.api.elements.actionDropzone.dispatchEvent({
      type: 'drop',
      preventDefault() {},
      stopPropagation() {},
      dataTransfer: { files: [{}] },
    });
    await nextTurn();

    assert.equal(errors.length, 1);
    assert.match(String(errors[0][0]), /registration failed/);
    assert.match(settings.api.elements.feedback.textContent, /画像の場所を取得できませんでした：registration failed/);
    assert.equal(settings.api.elements.feedback.classList.contains('is-error'), true);
  });
});

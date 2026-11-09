import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSettingsForTest } from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

const JPEG = Object.freeze({
  relativePath: 'actions/untouched.jpg',
  assetUrl: 'file:///actions/untouched.jpg',
  isJpeg: true,
});

test('JPG preparation cleans cancelled and converted sources but preserves same-file or newly referenced files', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const discarded = [];
    const settings = loadSettingsForTest({
      projectRoot,
      mascotAPI: {
        discardImportedImage: async (relativePath, category) => {
          discarded.push({ relativePath, category });
          return true;
        },
      },
    });

    assert.equal(
      await settings.api.prepareImportedImage(JPEG, 'actions', async () => null),
      null,
    );
    const png = {
      relativePath: 'actions/transparent.png',
      assetUrl: 'file:///actions/transparent.png',
      isJpeg: false,
    };
    assert.equal(
      await settings.api.prepareImportedImage(JPEG, 'actions', async () => png),
      png,
    );
    assert.equal(
      await settings.api.prepareImportedImage(JPEG, 'actions', async () => JPEG),
      JPEG,
    );

    let finishConversion;
    const pendingConversion = new Promise((resolve) => { finishConversion = resolve; });
    const preparation = settings.api.prepareImportedImage(
      JPEG,
      'actions',
      async () => pendingConversion,
    );
    settings.api.state.actions = [{ file: JPEG.relativePath, effect: null }];
    finishConversion(null);
    assert.equal(await preparation, null);

    assert.deepEqual(discarded, [
      { relativePath: JPEG.relativePath, category: 'actions' },
      { relativePath: JPEG.relativePath, category: 'actions' },
    ]);
  });
});

test('JPG cleanup IPC rejection is logged and does not escape preparation', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const warnings = [];
    const testConsole = new Proxy(console, {
      get(target, property) {
        if (property === 'warn') return (...args) => warnings.push(args);
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const settings = loadSettingsForTest({
      projectRoot,
      consoleObject: testConsole,
      mascotAPI: {
        discardImportedImage: async () => { throw new Error('cleanup IPC failed'); },
      },
    });

    assert.equal(
      await settings.api.prepareImportedImage(JPEG, 'actions', async () => null),
      null,
    );
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /未使用の取り込み画像を整理できませんでした/);
    assert.match(String(warnings[0][1]), /cleanup IPC failed/);
  });
});

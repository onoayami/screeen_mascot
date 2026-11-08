import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  loadMainForTest,
  loadPreloadForTest,
  loadSettingsForTest,
} from '../phase0/helpers/loaders.mjs';
import {
  recursiveManifest,
  withTemporaryProject,
} from '../phase0/helpers/workspace.mjs';

function validImageBytes(extension) {
  switch (extension) {
    case '.png':
      return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case '.gif':
      return Buffer.from('GIF89a', 'ascii');
    case '.jpg':
      return Buffer.from([0xff, 0xd8, 0xff]);
    case '.webp':
      return Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    case '.svg':
      return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
    default:
      throw new Error(`unsupported fixture extension: ${extension}`);
  }
}

function createMainWithWindows(projectRoot, userDataRoot, overrides = {}) {
  const main = loadMainForTest({ projectRoot, userDataRoot, ...overrides });
  main.api.createMascotWindow();
  main.api.openSettingsWindow();
  const mascotWindow = main.browserWindows.find((window) => window.options.transparent === true);
  const settingsWindow = main.browserWindows.find((window) => window.options.title === 'マスコット設定');
  assert.ok(mascotWindow);
  assert.ok(settingsWindow);
  return { main, mascotWindow, settingsWindow };
}

function eventFor(window, { url = null, topFrame = true } = {}) {
  const mainFrame = window.webContents.mainFrame;
  const senderFrame = topFrame && !url
    ? mainFrame
    : { url: url || mainFrame.url };
  return { sender: window.webContents, senderFrame };
}

test('A2-01: the runtime resolver rejects an external symbolic link', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters, temporaryRoot }) => {
    const outside = path.join(temporaryRoot, 'outside.png');
    fs.writeFileSync(outside, validImageBytes('.png'));
    fs.symlinkSync(outside, path.join(userCharacters, 'actions', 'external-link.png'));
    const { api } = loadMainForTest({ projectRoot, userDataRoot });
    assert.equal(api.resolveCharacterPath('actions/external-link.png'), null);
  });
});

test('A2-02: the runtime resolver rejects a directory disguised as an image', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    fs.mkdirSync(path.join(userCharacters, 'actions', 'folder.png'));
    const { api } = loadMainForTest({ projectRoot, userDataRoot });
    assert.equal(api.resolveCharacterPath('actions/folder.png'), null);
  });
});

test('A2-03: the runtime resolver rejects disallowed extensions and mismatched signatures', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    fs.writeFileSync(path.join(userCharacters, 'actions', 'plain.txt'), 'plain text');
    fs.writeFileSync(path.join(userCharacters, 'actions', 'fake.png'), 'not a png');
    const { api } = loadMainForTest({ projectRoot, userDataRoot });
    assert.equal(api.resolveCharacterPath('actions/plain.txt'), null);
    assert.equal(api.resolveCharacterPath('actions/fake.png'), null);
  });
});

test('A2-04: supported image signatures remain resolvable', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const { api } = loadMainForTest({ projectRoot, userDataRoot });
    for (const extension of ['.svg', '.png', '.gif', '.jpg', '.webp']) {
      const name = `valid${extension}`;
      fs.writeFileSync(path.join(userCharacters, 'actions', name), validImageBytes(extension));
      assert.equal(api.resolveCharacterPath(`actions/${name}`), path.join(userCharacters, 'actions', name));
    }
  });
});

test('A2-05: image import rejects a symbolic link without leaving a copy', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters, temporaryRoot }) => {
    const source = path.join(temporaryRoot, 'source.png');
    const link = path.join(temporaryRoot, 'source-link.png');
    fs.writeFileSync(source, validImageBytes('.png'));
    fs.symlinkSync(source, link);
    const before = recursiveManifest(path.join(userCharacters, 'actions'));
    const { api } = loadMainForTest({ projectRoot, userDataRoot });
    assert.throws(() => api.importImageFromPath(link, 'actions'), /通常ファイル|シンボリックリンク|画像/);
    assert.deepEqual(recursiveManifest(path.join(userCharacters, 'actions')), before);
  });
});

test('A2-06: image import rejects extension spoofing without leaving a copy', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters, temporaryRoot }) => {
    const source = path.join(temporaryRoot, 'spoofed.png');
    fs.writeFileSync(source, 'not a png');
    const before = recursiveManifest(path.join(userCharacters, 'actions'));
    const { api } = loadMainForTest({ projectRoot, userDataRoot });
    assert.throws(() => api.importImageFromPath(source, 'actions'), /画像形式|画像を読み込めません/);
    assert.deepEqual(recursiveManifest(path.join(userCharacters, 'actions')), before);
  });
});

test('A2-07: undecodable transparent PNG output is removed before commit', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const before = recursiveManifest(path.join(userCharacters, 'actions'));
    const { api } = loadMainForTest({
      projectRoot,
      userDataRoot,
      nativeImageOverrides: {
        createFromPath() { return { isEmpty() { return true; } }; },
      },
    });
    assert.throws(
      () => api.saveTransparentPng(validImageBytes('.png'), 'actions', 'converted.jpg'),
      /画像を読み込めません|デコード/,
    );
    assert.deepEqual(recursiveManifest(path.join(userCharacters, 'actions')), before);
  });
});

test('A2-08: settings mutations require the trusted settings top frame', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const { main, mascotWindow, settingsWindow } = createMainWithWindows(projectRoot, userDataRoot);
    const chooseImage = main.handlers.get('mascot:choose-image');
    await assert.rejects(() => chooseImage(eventFor(mascotWindow), 'actions'), /許可されていません/);
    await assert.rejects(
      () => chooseImage(eventFor(settingsWindow, { url: 'https://example.invalid/settings.html' }), 'actions'),
      /許可されていません/,
    );
    await assert.rejects(
      () => chooseImage(eventFor(settingsWindow, { topFrame: false }), 'actions'),
      /許可されていません/,
    );
    assert.equal(await chooseImage(eventFor(settingsWindow), 'actions'), null);
  });
});

test('A2-09: mascot-only mouse passthrough ignores the settings window', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const { main, mascotWindow, settingsWindow } = createMainWithWindows(projectRoot, userDataRoot);
    const listener = main.ipcListeners.get('mascot:set-mouse-passthrough');
    listener(eventFor(settingsWindow), false);
    assert.deepEqual(settingsWindow.ignoreMouseCalls, []);
    const before = mascotWindow.ignoreMouseCalls.length;
    listener(eventFor(mascotWindow), false);
    assert.equal(mascotWindow.ignoreMouseCalls.length, before + 1);
  });
});

test('A2-10: settings preload exposes no mascot-only capabilities', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const preload = loadPreloadForTest({ projectRoot, fileName: 'preload.js' });
    assert.equal(preload.exposedName, 'mascotAPI');
    assert.deepEqual(Object.keys(preload.api).sort(), [
      'chooseImage',
      'getAppInfo',
      'getAssetMetadata',
      'getPathForFile',
      'importImage',
      'loadConfig',
      'prepareDistributionDefaults',
      'recoverConfig',
      'reportDirtyState',
      'resolveAsset',
      'saveConfig',
      'saveTransparentPng',
    ]);
  });
});

test('A2-11: mascot preload exists and exposes only runtime capabilities', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const fileName = 'preload-mascot.js';
    assert.equal(fs.existsSync(path.join(projectRoot, fileName)), true, 'split mascot preload is missing');
    const preload = loadPreloadForTest({ projectRoot, fileName });
    assert.deepEqual(Object.keys(preload.api).sort(), [
      'loadConfig',
      'onCommand',
      'reportApplyResult',
      'reportDiagnostic',
      'resolveAsset',
      'setMousePassthrough',
    ]);
  });
});

test('A2-12: both windows use sandboxing and deny external navigation', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const { mascotWindow, settingsWindow } = createMainWithWindows(projectRoot, userDataRoot);
    assert.equal(settingsWindow.options.webPreferences.sandbox, true);
    assert.equal(mascotWindow.options.webPreferences.sandbox, true);
    assert.equal(path.basename(settingsWindow.options.webPreferences.preload), 'preload.js');
    assert.equal(path.basename(mascotWindow.options.webPreferences.preload), 'preload-mascot.js');
    for (const window of [settingsWindow, mascotWindow]) {
      assert.equal(
        window.webContents.windowOpenHandler?.({ url: 'https://example.invalid/' })?.action,
        'deny',
      );
      const event = {
        prevented: false,
        preventDefault() { this.prevented = true; },
      };
      window.webContents.emit('will-navigate', event, 'https://example.invalid/');
      assert.equal(event.prevented, true);
    }
  });
});

test('A2-13: missing desktop API disables editing instead of installing a success demo', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({
      projectRoot,
      provideMascotAPI: false,
      runBoot: true,
    });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settings.window.mascotAPI, undefined);
    for (const id of ['save-button', 'reload-button', 'prepare-release-button', 'add-action']) {
      assert.equal(settings.nodes.get(id)?.disabled, true, id);
    }
    assert.match(settings.nodes.get('feedback')?.textContent || '', /デスクトップアプリ|利用できません/);
    assert.doesNotMatch(settings.nodes.get('feedback')?.textContent || '', /保存済み|反映済み/);
  });
});

test('A2-14: a symbolic character root is rejected before legacy migration', async () => {
  await withTemporaryProject(async ({
    projectRoot,
    userDataRoot,
    userCharacters,
    temporaryRoot,
  }) => {
    const externalRoot = path.join(temporaryRoot, 'external-characters');
    fs.renameSync(userCharacters, externalRoot);
    const marker = path.join(externalRoot, 'do-not-touch.txt');
    fs.writeFileSync(marker, 'unchanged', 'utf8');
    fs.symlinkSync(externalRoot, userCharacters, 'dir');

    const main = loadMainForTest({ projectRoot, userDataRoot });
    assert.equal(main.api.resolveCharacterPath('actions/rest.svg'), null);
    assert.throws(
      () => main.api.ensureCharacterDirectory(),
      /素材フォルダがシンボリックリンク/,
    );
    assert.equal(fs.readFileSync(marker, 'utf8'), 'unchanged');
  });
});

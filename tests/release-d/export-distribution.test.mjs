import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createDistributionArchive,
  distributionUserDataName,
  readDistributionDefaults,
} from '../../shared/distribution.js';
import configRules from '../../shared/config-rules.js';
import {
  loadMainForTest,
  loadPreloadForTest,
  loadSettingsForTest,
} from '../phase0/helpers/loaders.mjs';
import { PROJECT_ROOT } from '../phase0/helpers/workspace.mjs';

const VALID_ID = '123e4567-e89b-42d3-a456-426614174000';
const CONFIG = {
  name: '配布用マスコット',
  mascot: { size: 180, startPosition: 'bottom-right', margin: 40, rememberPosition: true },
  actions: [{
    name: '休む',
    file: 'actions/rest.svg',
    weight: 1,
    durationMs: [6000, 10000],
    movement: { type: 'still', speed: 0 },
  }],
};

class LoadingImage {
  constructor() {
    this.naturalWidth = 100;
    this.naturalHeight = 100;
  }

  set src(value) {
    this._src = value;
    queueMicrotask(() => this.onload?.());
  }
}

function makeTempRoot() {
  return fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'distribution-test-'),
  );
}

function writeFile(root, relativePath, contents) {
  const filePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function makeCharacterRoot(root) {
  const characterRoot = path.join(root, 'characters');
  writeFile(characterRoot, 'config.json', JSON.stringify(CONFIG));
  writeFile(characterRoot, 'actions/rest.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  writeFile(characterRoot, 'actions/unreferenced-private.svg', '<svg>private</svg>');
  writeFile(characterRoot, 'diagnostic.log', 'private log');
  return characterRoot;
}

function makeAppBundle(root, withPriorDistribution = false) {
  const bundle = path.join(root, 'Desktop Mascot.app');
  const executable = writeFile(bundle, 'Contents/MacOS/Desktop Mascot', 'executable');
  writeFile(bundle, 'Contents/Info.plist', JSON.stringify({
    CFBundleExecutable: 'Desktop Mascot',
    CFBundleIdentifier: 'com.github.onoayami.desktopmascot',
    CFBundleName: 'Desktop Mascot',
    CFBundleDisplayName: 'Desktop Mascot',
  }));
  writeFile(bundle, 'Contents/Resources/app.asar', 'unchanged app asar');
  writeFile(bundle, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Framework', 'framework');
  writeFile(bundle, 'Contents/Frameworks/Desktop Mascot Helper.app/Contents/MacOS/Desktop Mascot Helper', 'helper executable');
  writeFile(bundle, 'Contents/Frameworks/Desktop Mascot Helper.app/Contents/Info.plist', JSON.stringify({
    CFBundleExecutable: 'Desktop Mascot Helper',
    CFBundleIdentifier: 'com.github.onoayami.desktopmascot.helper',
    CFBundleName: 'Desktop Mascot Helper',
  }));
  fs.symlinkSync(
    'A',
    path.join(bundle, 'Contents/Frameworks/Electron Framework.framework/Versions/Current'),
  );
  if (withPriorDistribution) {
    writeFile(bundle, 'Contents/Resources/distribution-defaults/manifest.json', '{}');
    writeFile(bundle, 'Contents/Resources/distribution-defaults/config.json', '{}');
  }
  return { bundle, executable };
}

function fakeNativeRunner({ failOn = null, onArchive } = {}) {
  const calls = [];
  const execFileAsync = async (executable, args) => {
    calls.push({ executable, args: [...args] });
    const operation = executable.split('/').at(-1);
    const operationLabel = operation === 'ditto' && args[0] === '-c'
      ? 'ditto-archive'
      : operation;
    if (failOn === operation || failOn === operationLabel) {
      const error = new Error(`${operation} failed`);
      error.stderr = 'simulated native command failure';
      throw error;
    }
    if (operation === 'ditto' && args[0] !== '-c') {
      fs.cpSync(args[0], args[1], { recursive: true, dereference: false });
    } else if (operation === 'ditto') {
      onArchive?.(args.at(-2));
      fs.writeFileSync(args.at(-1), 'mock zip');
    } else if (operation === 'plutil') {
      const [verb, key, , value, plistPath] = args;
      assert.equal(verb, '-replace');
      const plist = JSON.parse(fs.readFileSync(plistPath, 'utf8'));
      plist[key] = value;
      fs.writeFileSync(plistPath, JSON.stringify(plist));
    }
    return { stdout: '', stderr: '' };
  };
  return { calls, execFileAsync };
}

function invokeExport({
  root,
  app,
  characterRoot,
  destination,
  execFileAsync,
  dialogResult = { canceled: false, filePath: destination },
  loadExportData = () => ({ config: CONFIG, characterRoot }),
  fsModule = fs,
  validateAsset,
}) {
  let dialogCalls = 0;
  const userDataPath = path.join(root, 'user-data');
  fs.mkdirSync(userDataPath, { recursive: true });
  return {
    getDialogCalls: () => dialogCalls,
    promise: createDistributionArchive({
      dialog: {
        async showSaveDialog() {
          dialogCalls += 1;
          return dialogResult;
        },
      },
      executablePath: app.executable,
      appIsPackaged: true,
      userDataPath,
      loadExportData,
      fsModule,
      osModule: { homedir: () => root },
      execFileAsync,
      randomId: () => VALID_ID,
      validateAsset,
      platform: 'darwin',
    }),
  };
}

test('distribution override validation is strict and its data folder is stable and unique', () => {
  const root = makeTempRoot();
  try {
    const resources = path.join(root, 'Resources');
    const defaults = path.join(resources, 'distribution-defaults');
    writeFile(defaults, 'manifest.json', JSON.stringify({ id: VALID_ID, name: CONFIG.name }));
    writeFile(defaults, 'config.json', JSON.stringify(CONFIG));
    writeFile(defaults, 'actions/rest.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const loaded = readDistributionDefaults(resources);
    assert.equal(loaded.id, VALID_ID);
    assert.equal(loaded.root, defaults);
    assert.equal(distributionUserDataName(loaded.id), `Desktop Mascot-distribution-${VALID_ID}`);
    assert.notEqual(
      distributionUserDataName(VALID_ID),
      distributionUserDataName('123e4567-e89b-42d3-a456-426614174001'),
    );

    fs.writeFileSync(path.join(defaults, 'manifest.json'), JSON.stringify({ id: 'bad', name: CONFIG.name }));
    assert.throws(() => readDistributionDefaults(resources), /マニフェスト/);
    fs.writeFileSync(path.join(defaults, 'manifest.json'), JSON.stringify({ id: VALID_ID, name: CONFIG.name }));
    fs.rmSync(path.join(defaults, 'actions', 'rest.svg'));
    assert.throws(() => readDistributionDefaults(resources), /読み込めません/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('packaged distribution bootstraps isolated data before locking and restores its own defaults', () => {
  const root = makeTempRoot();
  try {
    const app = makeAppBundle(root);
    const resources = path.join(root, 'Resources');
    const defaults = path.join(resources, 'distribution-defaults');
    const normalizedConfig = configRules.validateAndNormalizeConfig(CONFIG);
    writeFile(defaults, 'manifest.json', JSON.stringify({ id: VALID_ID, name: CONFIG.name }));
    writeFile(defaults, 'config.json', JSON.stringify(normalizedConfig));
    writeFile(defaults, 'actions/rest.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    const packaged = loadMainForTest({
      projectRoot: PROJECT_ROOT,
      appDataRoot: path.join(root, 'Application Support'),
      resourcesPath: resources,
      executablePath: app.executable,
      platform: 'darwin',
      execFileSyncOverride: () => `com.github.onoayami.desktopmascot.dist.${VALID_ID.replace(/-/gu, '')}\n`,
      appOverrides: { isPackaged: true },
    });
    const distributedData = path.join(
      root,
      'Application Support',
      `Desktop Mascot-distribution-${VALID_ID}`,
    );
    assert.equal(packaged.api.getCharacterDirectory(), path.join(distributedData, 'characters'));
    assert.ok(
      packaged.pathCalls.findIndex((call) => call.method === 'setPath' && call.name === 'userData')
      < packaged.pathCalls.findIndex((call) => call.method === 'requestSingleInstanceLock'),
    );
    packaged.api.ensureCharacterDirectory();
    assert.equal(
      fs.readFileSync(path.join(distributedData, 'characters/actions/rest.svg'), 'utf8'),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    );
    const customized = { ...normalizedConfig, name: '受取人の設定' };
    packaged.api.writeConfigAtomic(customized);
    const recovered = packaged.api.recoverEditableConfig('defaults');
    assert.equal(recovered.ok, true);
    assert.equal(packaged.api.loadEditableConfig().config.name, CONFIG.name);

    const ordinary = loadMainForTest({
      projectRoot: PROJECT_ROOT,
      appDataRoot: path.join(root, 'Application Support'),
      platform: 'darwin',
    });
    assert.equal(
      ordinary.appPaths.get('userData'),
      path.join(root, 'Application Support', 'Desktop Mascot'),
    );

    const ordinaryPackaged = loadMainForTest({
      projectRoot: PROJECT_ROOT,
      appDataRoot: path.join(root, 'Application Support'),
      resourcesPath: path.join(root, 'OrdinaryResources'),
      executablePath: app.executable,
      platform: 'darwin',
      execFileSyncOverride: () => 'com.github.onoayami.desktopmascot\n',
      appOverrides: { isPackaged: true },
    });
    assert.equal(
      ordinaryPackaged.api.getCharacterDirectory(),
      path.join(root, 'Application Support', 'Desktop Mascot', 'characters'),
    );
    assert.equal(
      ordinaryPackaged.api.getBundledCharacterDirectory(),
      path.join(PROJECT_ROOT, 'characters', 'default'),
    );

    const partialResources = path.join(root, 'PartialResources');
    fs.mkdirSync(path.join(partialResources, 'distribution-defaults'), { recursive: true });
    assert.throws(() => loadMainForTest({
      projectRoot: PROJECT_ROOT,
      appDataRoot: path.join(root, 'Partial Support'),
      resourcesPath: partialResources,
      executablePath: app.executable,
      platform: 'darwin',
      execFileSyncOverride: () => `com.github.onoayami.desktopmascot.dist.${VALID_ID.replace(/-/gu, '')}\n`,
      appOverrides: { isPackaged: true },
    }), /配布版の初期設定を読み込めません/);

    const missingResources = path.join(root, 'MissingResources');
    fs.mkdirSync(missingResources);
    assert.throws(() => loadMainForTest({
      projectRoot: PROJECT_ROOT,
      appDataRoot: path.join(root, 'Missing Support'),
      resourcesPath: missingResources,
      executablePath: app.executable,
      platform: 'darwin',
      execFileSyncOverride: () => `com.github.onoayami.desktopmascot.dist.${VALID_ID.replace(/-/gu, '')}\n`,
      appOverrides: { isPackaged: true },
    }), /配布版の初期設定が見つかりません/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('main IPC rejects duplicate in-flight exports and resolves cancellation safely', async () => {
  const root = makeTempRoot();
  try {
    const app = makeAppBundle(root);
    let resolveDialog;
    const main = loadMainForTest({
      projectRoot: PROJECT_ROOT,
      appDataRoot: path.join(root, 'Application Support'),
      resourcesPath: path.join(root, 'Resources'),
      executablePath: app.executable,
      platform: 'darwin',
      execFileSyncOverride: () => 'com.github.onoayami.desktopmascot\n',
      appOverrides: { isPackaged: true },
      dialogOverrides: {
        showSaveDialog: () => new Promise((resolve) => { resolveDialog = resolve; }),
      },
    });
    main.api.openSettingsWindow();
    const settingsWindow = main.browserWindows.find((window) => window.loadedFile === 'settings.html');
    const event = {
      sender: settingsWindow.webContents,
      senderFrame: settingsWindow.webContents.mainFrame,
    };
    const handler = main.handlers.get('mascot:export-distribution');
    const first = handler(event);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settingsWindow.close(), false);
    await assert.rejects(handler(event), /配布版を作成中/);
    resolveDialog({ canceled: true, filePath: undefined });
    assert.equal((await first).canceled, true);
    assert.equal(settingsWindow.close(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('export copies only referenced assets, refreshes prior data, preserves bundle symlinks, and publishes atomically', async () => {
  const root = makeTempRoot();
  try {
    const app = makeAppBundle(root, true);
    const originalPlist = fs.readFileSync(path.join(app.bundle, 'Contents/Info.plist'), 'utf8');
    const characterRoot = makeCharacterRoot(root);
    const destination = path.join(root, 'Desktop Mascot 配布版.zip');
    fs.writeFileSync(destination, 'previous archive');
    let capturedFiles = [];
    let capturedManifest;
    const runner = fakeNativeRunner({
      onArchive(appCopy) {
        const defaults = path.join(appCopy, 'Contents/Resources/distribution-defaults');
        capturedFiles = fs.readdirSync(defaults).sort();
        capturedManifest = JSON.parse(fs.readFileSync(path.join(defaults, 'manifest.json'), 'utf8'));
        assert.deepEqual(fs.readdirSync(path.join(defaults, 'actions')), ['rest.svg']);
        assert.equal(fs.readFileSync(path.join(defaults, 'actions/rest.svg'), 'utf8'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
        assert.equal(fs.readFileSync(path.join(appCopy, 'Contents/Resources/app.asar'), 'utf8'), 'unchanged app asar');
        const copiedPlist = JSON.parse(fs.readFileSync(path.join(appCopy, 'Contents/Info.plist'), 'utf8'));
        assert.equal(
          copiedPlist.CFBundleIdentifier,
          `com.github.onoayami.desktopmascot.dist.${capturedManifest.id.replace(/-/gu, '')}`,
        );
        assert.equal(copiedPlist.CFBundleName, 'Desktop Mascot');
        assert.equal(copiedPlist.CFBundleDisplayName, 'Desktop Mascot');
        assert.equal(copiedPlist.CFBundleExecutable, 'Desktop Mascot');
        const helperPath = path.join(appCopy, 'Contents/Frameworks/Desktop Mascot Helper.app');
        const helperPlist = JSON.parse(fs.readFileSync(path.join(helperPath, 'Contents/Info.plist'), 'utf8'));
        assert.equal(helperPlist.CFBundleName, 'Desktop Mascot Helper');
        assert.equal(helperPlist.CFBundleExecutable, 'Desktop Mascot Helper');
        assert.equal(
          fs.readFileSync(path.join(helperPath, 'Contents/MacOS/Desktop Mascot Helper'), 'utf8'),
          'helper executable',
        );
        assert.equal(fs.lstatSync(path.join(appCopy, 'Contents/Frameworks/Electron Framework.framework/Versions/Current')).isSymbolicLink(), true);
      },
    });
    const { promise } = invokeExport({
      root, app, characterRoot, destination, execFileAsync: runner.execFileAsync,
    });
    const result = await promise;
    assert.equal(result.filePath, destination);
    assert.deepEqual(capturedFiles, ['actions', 'config.json', 'manifest.json']);
    assert.equal(capturedManifest.id, VALID_ID);
    assert.equal(capturedManifest.name, CONFIG.name);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'mock zip');
    assert.equal(fs.readFileSync(path.join(app.bundle, 'Contents/Info.plist'), 'utf8'), originalPlist);
    assert.equal(fs.existsSync(path.join(app.bundle, 'Contents/Resources/distribution-defaults')), true);
    assert.equal(fs.existsSync(path.join(characterRoot, 'diagnostic.log')), true);
    assert.equal(runner.calls.filter(({ executable }) => executable.endsWith('/codesign')).length, 2);
    const plistCalls = runner.calls.filter(({ executable }) => executable.endsWith('/plutil'));
    assert.equal(plistCalls.length, 1);
    assert.deepEqual(plistCalls[0].args.slice(0, 2), ['-replace', 'CFBundleIdentifier']);
    assert.equal(fs.readdirSync(root).some((name) => name.startsWith('.Desktop Mascot 配布版-')), false);
    assert.equal(fs.readdirSync(root).some((name) => name.startsWith('.desktop-mascot-distribution-')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('long valid configuration names survive export and recipient startup validation', async () => {
  const root = makeTempRoot();
  try {
    const app = makeAppBundle(root);
    const characterRoot = makeCharacterRoot(root);
    const destination = path.join(root, 'long-name.zip');
    const longConfig = configRules.validateAndNormalizeConfig({
      ...CONFIG,
      name: '長いマスコット名'.repeat(24),
    });
    let importedDefaults;
    const runner = fakeNativeRunner({
      onArchive(appCopy) {
        importedDefaults = readDistributionDefaults(
          path.join(appCopy, 'Contents', 'Resources'),
          { validateConfig: configRules.validateAndNormalizeConfig },
        );
      },
    });
    const { promise } = invokeExport({
      root,
      app,
      characterRoot,
      destination,
      execFileAsync: runner.execFileAsync,
      loadExportData: () => ({ config: longConfig, characterRoot }),
    });
    const result = await promise;
    assert.equal(result.canceled, false);
    assert.equal(importedDefaults.name, longConfig.name);
    assert.deepEqual(importedDefaults.config, longConfig);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cancel, validation failures, and signing failures preserve original data and any previous ZIP', async () => {
  const root = makeTempRoot();
  try {
    const app = makeAppBundle(root);
    const characterRoot = makeCharacterRoot(root);
    const destination = path.join(root, 'existing.zip');
    fs.writeFileSync(destination, 'previous archive');

    const canceled = invokeExport({
      root,
      app,
      characterRoot,
      destination,
      execFileAsync: async () => { throw new Error('must not execute'); },
      dialogResult: { canceled: true, filePath: undefined },
      loadExportData: () => { throw new Error('must not load config'); },
    });
    assert.deepEqual(await canceled.promise, { canceled: true });
    assert.equal(canceled.getDialogCalls(), 1);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'previous archive');

    const runner = fakeNativeRunner({ failOn: 'codesign' });
    const failed = invokeExport({
      root, app, characterRoot, destination, execFileAsync: runner.execFileAsync,
    });
    await assert.rejects(failed.promise, /署名に失敗しました.*simulated native command failure/);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'previous archive');
    assert.equal(fs.readFileSync(path.join(app.bundle, 'Contents/Info.plist'), 'utf8').includes('dist.'), false);
    assert.equal(fs.readdirSync(root).some((name) => name.startsWith('.desktop-mascot-distribution-')), false);

    const zipRunner = fakeNativeRunner({ failOn: 'ditto-archive' });
    const zipFailed = invokeExport({
      root, app, characterRoot, destination, execFileAsync: zipRunner.execFileAsync,
    });
    await assert.rejects(zipFailed.promise, /ZIPの作成に失敗しました/);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'previous archive');
    assert.equal(fs.readdirSync(root).some((name) => name.startsWith('.existing-')), false);
    assert.equal(fs.readdirSync(root).some((name) => name.startsWith('.desktop-mascot-distribution-')), false);

    const protectedBundlePath = path.join(app.bundle, 'Contents', 'Resources', 'inside.zip');
    const insideBundle = invokeExport({
      root,
      app,
      characterRoot,
      destination: protectedBundlePath,
      execFileAsync: zipRunner.execFileAsync,
    });
    await assert.rejects(insideBundle.promise, /元のアプリの中には保存できません/);
    assert.equal(fs.existsSync(protectedBundlePath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('export rejects symlinked assets and protected output locations', async () => {
  const root = makeTempRoot();
  try {
    const app = makeAppBundle(root);
    const characterRoot = makeCharacterRoot(root);
    const outside = writeFile(root, 'outside.svg', '<svg></svg>');
    fs.rmSync(path.join(characterRoot, 'actions/rest.svg'));
    fs.symlinkSync(outside, path.join(characterRoot, 'actions/rest.svg'));
    const destination = path.join(root, 'out.zip');
    const runner = fakeNativeRunner();
    const symlinked = invokeExport({
      root, app, characterRoot, destination, execFileAsync: runner.execFileAsync,
    });
    await assert.rejects(symlinked.promise, /シンボリックリンク/);
    assert.equal(fs.existsSync(destination), false);

    const safeCharacterRoot = makeCharacterRoot(path.join(root, 'other'));
    const protectedDestination = path.join(root, 'user-data', 'out.zip');
    fs.mkdirSync(path.dirname(protectedDestination), { recursive: true });
    const protectedResult = invokeExport({
      root,
      app,
      characterRoot: safeCharacterRoot,
      destination: protectedDestination,
      execFileAsync: runner.execFileAsync,
    });
    await assert.rejects(protectedResult.promise, /設定や画像の保存フォルダ/);

    const userDataPath = path.join(root, 'user-data');
    const deniedFs = new Proxy(fs, {
      get(target, property) {
        if (property === 'realpathSync') {
          return (candidate, ...args) => {
            if (path.resolve(candidate) === path.resolve(userDataPath)) {
              const error = new Error('permission denied');
              error.code = 'EACCES';
              throw error;
            }
            return target.realpathSync(candidate, ...args);
          };
        }
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const denied = invokeExport({
      root,
      app,
      characterRoot: safeCharacterRoot,
      destination: path.join(root, 'denied.zip'),
      execFileAsync: runner.execFileAsync,
      fsModule: deniedFs,
    });
    await assert.rejects(denied.promise, /保護対象フォルダの場所を確認できません.*permission denied/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('settings save first, aborts on failed or stale saves, and blocks duplicate or stale exports', async () => {
  const config = structuredClone(CONFIG);
  const events = [];
  let settings;
  let resolveExport;
  settings = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    consoleObject: { error() {} },
    mascotAPI: {
      loadConfig: async () => ({ config: structuredClone(config) }),
      saveConfig: async (payload) => {
        events.push('save');
        return { ok: true, applied: true, config: payload };
      },
      exportDistribution: async () => {
        events.push('export');
        return new Promise((resolve) => { resolveExport = resolve; });
      },
    },
  });
  await settings.api.loadConfiguration();
  settings.api.state.actions[0].name = '新しい名前';
  settings.api.markDirty();

  const exportPromise = settings.api.createDistribution();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['save', 'export']);
  assert.equal(settings.api.state.busy, true);
  assert.equal(settings.api.elements.workspace.inert, true);
  assert.equal(await settings.api.createDistribution(), false);
  settings.api.state.actions[0].name = '編集中の変更';
  settings.api.markDirty();
  resolveExport({ canceled: false, fileName: 'out.zip' });
  assert.equal(await exportPromise, false);
  assert.match(settings.api.elements.feedback.textContent, /最新の設定が含まれていない可能性/);
  assert.equal(settings.api.state.busy, false);
  assert.equal(settings.api.elements.workspace.inert, false);
  assert.deepEqual(events, ['save', 'export']);

  let staleSettings;
  let staleExports = 0;
  const staleSave = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    consoleObject: { error() {} },
    mascotAPI: {
      loadConfig: async () => ({ config: structuredClone(config) }),
      saveConfig: async (payload) => {
        staleSettings.api.state.actions[0].name = '保存中の新しい編集';
        staleSettings.api.markDirty();
        return { ok: true, applied: true, config: payload };
      },
      exportDistribution: async () => {
        staleExports += 1;
        return { canceled: false, fileName: 'stale.zip' };
      },
    },
  });
  staleSettings = staleSave;
  await staleSettings.api.loadConfiguration();
  staleSettings.api.state.actions[0].name = '保存する編集';
  staleSettings.api.markDirty();
  assert.equal(await staleSettings.api.createDistribution(), false);
  assert.equal(staleExports, 0);
  assert.equal(staleSettings.api.state.dirty, true);

  const canceledSettings = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    mascotAPI: {
      loadConfig: async () => ({ config: structuredClone(config) }),
      exportDistribution: async () => ({ canceled: true }),
    },
  });
  await canceledSettings.api.loadConfiguration();
  assert.equal(await canceledSettings.api.createDistribution(), false);
  assert.match(canceledSettings.api.elements.toast.textContent, /キャンセルしました/);

  const invalidResult = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    consoleObject: { error() {} },
    mascotAPI: {
      loadConfig: async () => ({ config: structuredClone(config) }),
      exportDistribution: async () => undefined,
    },
  });
  await invalidResult.api.loadConfiguration();
  assert.equal(await invalidResult.api.createDistribution(), false);
  assert.match(invalidResult.api.elements.feedback.textContent, /配布版を作成できませんでした/);
  assert.doesNotMatch(invalidResult.api.elements.toast.textContent, /配布版ZIPを作成しました/);

  let exportCalls = 0;
  const failing = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    consoleObject: { error() {} },
    mascotAPI: {
      loadConfig: async () => ({ config: structuredClone(config) }),
      saveConfig: async () => { throw new Error('save failed'); },
      exportDistribution: async () => { exportCalls += 1; return { fileName: 'bad.zip' }; },
    },
  });
  await failing.api.loadConfiguration();
  failing.api.state.actions[0].name = '未保存';
  failing.api.markDirty();
  assert.equal(await failing.api.createDistribution(), false);
  assert.equal(exportCalls, 0);
});

test('distribution button replaces the old reload/discard action', () => {
  const settings = loadSettingsForTest({ projectRoot: PROJECT_ROOT });
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'settings.html'), 'utf8');
  assert.match(html, /id="distribution-button"[^>]*>配布版作成/);
  assert.doesNotMatch(html, /id="reload-button"/);
  assert.equal(settings.api.elements.distributionButton.id, 'distribution-button');
});

test('preload exposes only a path-free distribution export request', async () => {
  const preload = loadPreloadForTest({ projectRoot: PROJECT_ROOT });
  assert.equal(typeof preload.api.exportDistribution, 'function');
  await preload.api.exportDistribution();
  assert.equal(preload.invoked.at(-1).channel, 'mascot:export-distribution');
  assert.equal(preload.invoked.at(-1).args.length, 0);
});

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  loadMainForTest,
  loadPreloadForTest,
  loadSettingsForTest,
} from '../phase0/helpers/loaders.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

class LoadingImage {
  constructor() {
    this.naturalWidth = 100;
    this.naturalHeight = 100;
  }

  set src(value) {
    this._src = value;
    queueMicrotask(() => this.onload?.());
  }

  get src() {
    return this._src;
  }
}

function assertVmEqual(actual, expected) {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
}

function createLoginMain({
  packaged = true,
  platform = 'darwin',
  status = 'not-registered',
  getError = null,
  setError = null,
  setStatus = null,
} = {}) {
  const calls = [];
  let currentStatus = status;
  const main = loadMainForTest({
    projectRoot: PROJECT_ROOT,
    platform,
    appOverrides: {
      isPackaged: packaged,
      getLoginItemSettings() {
        if (getError) throw getError;
        return { status: currentStatus, openAtLogin: currentStatus === 'enabled' };
      },
      setLoginItemSettings(settings) {
        calls.push(settings);
        if (setError) throw setError;
        currentStatus = setStatus || (settings.openAtLogin ? 'enabled' : 'not-registered');
      },
    },
  });
  main.api.openSettingsWindow();
  const settingsWindow = main.browserWindows[0];
  const trustedEvent = {
    sender: settingsWindow.webContents,
    senderFrame: settingsWindow.webContents.mainFrame,
  };
  const invoke = (channel, ...args) => main.handlers.get(channel)(trustedEvent, ...args);
  return { ...main, calls, invoke, settingsWindow };
}

function loginStatus(enabled, status = enabled ? 'enabled' : 'not-registered') {
  return {
    supported: true,
    enabled,
    requiresApproval: status === 'requires-approval',
    notFound: status === 'not-found',
    status,
  };
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('packaged macOS login-item IPC reads OS status and writes only the exact boolean setting', async () => {
  const main = createLoginMain();
  assertVmEqual(await main.invoke('mascot:get-login-item-settings'), loginStatus(false));
  assertVmEqual(await main.invoke('mascot:set-login-item-settings', true), loginStatus(true));
  assertVmEqual(main.calls, [{ openAtLogin: true }]);
  assertVmEqual(await main.invoke('mascot:set-login-item-settings', false), loginStatus(false));
  assertVmEqual(main.calls, [{ openAtLogin: true }, { openAtLogin: false }]);
});

test('login-item IPC is unsupported in development and on non-macOS without touching the OS API', async () => {
  for (const options of [{ packaged: false }, { platform: 'win32' }]) {
    const main = createLoginMain(options);
    assertVmEqual(await main.invoke('mascot:get-login-item-settings'), {
      supported: false,
      enabled: false,
      requiresApproval: false,
      notFound: false,
      status: 'unsupported',
    });
    assert.equal((await main.invoke('mascot:set-login-item-settings', true)).supported, false);
    assertVmEqual(main.calls, []);
  }
});

test('login-item IPC rejects non-booleans and untrusted settings senders', async () => {
  const main = createLoginMain();
  await assert.rejects(main.invoke('mascot:set-login-item-settings', 'true'), /真偽値/);
  await assert.rejects(
    main.handlers.get('mascot:set-login-item-settings')({
      ...main.settingsWindow.webContents,
      sender: main.settingsWindow.webContents,
      senderFrame: { url: 'https://example.invalid/' },
    }, true),
    /許可されていません/,
  );
  assertVmEqual(main.calls, []);
});

test('login-item IPC propagates OS read and write errors and reports approval/not-found states', async () => {
  const readFailure = createLoginMain({ getError: new Error('read failed') });
  await assert.rejects(readFailure.invoke('mascot:get-login-item-settings'), /read failed/);

  const writeFailure = createLoginMain({ setError: new Error('write failed') });
  await assert.rejects(writeFailure.invoke('mascot:set-login-item-settings', true), /write failed/);
  assertVmEqual(writeFailure.calls, [{ openAtLogin: true }]);

  const approval = createLoginMain({ status: 'requires-approval' });
  assertVmEqual(await approval.invoke('mascot:get-login-item-settings'), loginStatus(false, 'requires-approval'));

  const notFound = createLoginMain({ status: 'not-found' });
  assertVmEqual(await notFound.invoke('mascot:get-login-item-settings'), loginStatus(false, 'not-found'));

  const mismatch = createLoginMain({ setStatus: 'not-registered' });
  assertVmEqual(await mismatch.invoke('mascot:set-login-item-settings', true), loginStatus(false));
});

test('settings startup and configuration saving never register the login item', async () => {
  let registrationCalls = 0;
  const settings = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    mascotAPI: {
      setLoginItemSettings: async (openAtLogin) => {
        registrationCalls += 1;
        return loginStatus(openAtLogin);
      },
    },
  });
  await settings.api.loadConfiguration();
  await settle();
  settings.api.elements.mascotSize.value = '220';
  settings.api.elements.mascotSize.dispatchEvent({ type: 'input' });
  assert.equal(await settings.api.saveConfiguration(), true);
  assert.equal(registrationCalls, 0);
});

test('settings login-item read is independent of configuration load failure', async () => {
  let loginReads = 0;
  const settings = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    consoleObject: { error() {} },
    mascotAPI: {
      loadConfig: async () => { throw new Error('config unavailable'); },
      getLoginItemSettings: async () => {
        loginReads += 1;
        return loginStatus(true);
      },
    },
  });
  await settings.api.loadConfiguration();
  await settle();
  assert.equal(loginReads, 1);
  assert.equal(settings.api.elements.loginAtStartup.checked, true);
  assert.match(settings.api.elements.loginAtStartupStatus.textContent, /次回ログイン時から起動/);
});

test('settings login checkbox waits for OS confirmation and preserves config dirty/save state', async () => {
  let setCalls = 0;
  let loginReads = 0;
  let finishWrite;
  const settings = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    mascotAPI: {
      getLoginItemSettings: async () => {
        loginReads += 1;
        return loginStatus(false);
      },
      setLoginItemSettings: (openAtLogin) => {
        setCalls += 1;
        return new Promise((resolve) => { finishWrite = () => resolve(loginStatus(openAtLogin)); });
      },
    },
  });
  const { api, window } = settings;
  await api.loadConfiguration();
  await settle();
  const checkbox = api.elements.loginAtStartup;
  assert.equal(checkbox.disabled, false);
  assert.equal(checkbox.checked, false);
  assert.equal(loginReads, 1);

  api.elements.mascotSize.value = '240';
  api.elements.mascotSize.dispatchEvent({ type: 'input' });
  assert.equal(api.state.dirty, true);
  const saveButtonDisabled = api.elements.saveButton.disabled;

  checkbox.checked = true;
  checkbox.dispatchEvent({ type: 'change' });
  assert.equal(setCalls, 1);
  assert.equal(checkbox.disabled, true);
  assert.equal(checkbox.checked, false);
  assert.match(api.elements.loginAtStartupStatus.textContent, /更新しています/);
  window.dispatch('focus');
  await settle();
  assert.equal(loginReads, 1);
  assert.equal(checkbox.disabled, true);

  finishWrite();
  await settle();
  assert.equal(checkbox.checked, true);
  assert.equal(checkbox.disabled, false);
  assert.equal(api.state.dirty, true);
  assert.equal(api.elements.saveButton.disabled, saveButtonDisabled);
  assert.equal(api.elements.feedback.classList.contains('is-error'), false);
});

test('settings refreshes login-item state on focus, exposes unsupported/approval states, and reports write mismatch', async () => {
  let reads = 0;
  let nextStatus = loginStatus(false);
  const settings = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    mascotAPI: {
      getLoginItemSettings: async () => {
        reads += 1;
        return nextStatus;
      },
      setLoginItemSettings: async () => loginStatus(false, 'requires-approval'),
    },
  });
  const { api, window } = settings;
  await api.loadConfiguration();
  await settle();
  assert.equal(reads, 1);
  nextStatus = loginStatus(false, 'requires-approval');
  window.dispatch('focus');
  await settle();
  assert.equal(reads, 2);
  assert.equal(api.elements.loginAtStartup.disabled, false);
  assert.match(api.elements.loginAtStartupStatus.textContent, /システム設定 → 一般 → ログイン項目/);

  await api.loadConfiguration();
  await settle();
  assert.equal(reads, 3);

  api.elements.loginAtStartup.checked = true;
  await api.setLoginAtStartup();
  assert.equal(api.elements.loginAtStartup.checked, false);
  assert.equal(api.elements.loginAtStartupStatus.classList.contains('is-error'), true);
  assert.match(api.elements.loginAtStartupStatus.textContent, /反映できませんでした/);
  assert.match(api.elements.loginAtStartupStatus.textContent, /許可/);

  const unsupported = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    mascotAPI: { getLoginItemSettings: async () => ({ ...loginStatus(false), supported: false, status: 'unsupported' }) },
  });
  await unsupported.api.loadConfiguration();
  await settle();
  assert.equal(unsupported.api.elements.loginAtStartup.disabled, true);
  assert.match(unsupported.api.elements.loginAtStartupStatus.textContent, /インストール済みのmacOSアプリ/);
});

test('settings leaves login toggle disabled and exposes read failures until a later refresh succeeds', async () => {
  let failRead = true;
  const settings = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    mascotAPI: {
      getLoginItemSettings: async () => {
        if (failRead) throw new Error('status unavailable');
        return loginStatus(true);
      },
    },
  });
  await settings.api.loadConfiguration();
  await settle();
  const checkbox = settings.api.elements.loginAtStartup;
  assert.equal(checkbox.disabled, true);
  assert.match(settings.api.elements.loginAtStartupStatus.textContent, /status unavailable/);
  assert.equal(settings.api.elements.loginAtStartupStatus.classList.contains('is-error'), true);

  failRead = false;
  settings.window.dispatch('focus');
  await settle();
  assert.equal(checkbox.disabled, false);
  assert.equal(checkbox.checked, true);
  assert.equal(settings.api.elements.loginAtStartupStatus.classList.contains('is-error'), false);
});

test('settings reports write failures, refreshes actual OS state, and keeps failed state explicit', async () => {
  let reads = 0;
  const settings = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    mascotAPI: {
      getLoginItemSettings: async () => {
        reads += 1;
        return loginStatus(false);
      },
      setLoginItemSettings: async () => { throw new Error('OS refused registration'); },
    },
  });
  await settings.api.loadConfiguration();
  await settle();
  settings.api.elements.loginAtStartup.checked = true;
  await settings.api.setLoginAtStartup();
  assert.equal(reads, 2);
  assert.equal(settings.api.elements.loginAtStartup.checked, false);
  assert.equal(settings.api.elements.loginAtStartup.disabled, false);
  assert.match(settings.api.elements.loginAtStartupStatus.textContent, /OS refused registration/);
  assert.match(settings.api.elements.loginAtStartupStatus.textContent, /システム設定 → 一般 → ログイン項目/);
  assert.equal(settings.api.elements.loginAtStartupStatus.classList.contains('is-error'), true);
});

test('write failure keeps a successful OS readback and does not change configuration dirty state', async () => {
  let reads = 0;
  const settings = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    mascotAPI: {
      getLoginItemSettings: async () => {
        reads += 1;
        return loginStatus(reads > 1);
      },
      setLoginItemSettings: async () => { throw new Error('registration rejected'); },
    },
  });
  await settings.api.loadConfiguration();
  await settle();
  settings.api.elements.mascotSize.value = '230';
  settings.api.elements.mascotSize.dispatchEvent({ type: 'input' });
  const saveButtonDisabled = settings.api.elements.saveButton.disabled;

  settings.api.elements.loginAtStartup.checked = true;
  assert.equal(await settings.api.setLoginAtStartup(), false);
  assert.equal(settings.api.state.loginItemKnown, true);
  assert.equal(settings.api.elements.loginAtStartup.checked, true);
  assert.equal(settings.api.elements.loginAtStartup.disabled, false);
  assert.match(settings.api.elements.loginAtStartupStatus.textContent, /registration rejected/);
  assert.match(settings.api.elements.loginAtStartupStatus.textContent, /状態を再確認しました/);
  assert.equal(settings.api.state.dirty, true);
  assert.equal(settings.api.elements.saveButton.disabled, saveButtonDisabled);
  assert.equal(settings.api.elements.loginAtStartupStatus.classList.contains('is-error'), true);
});

test('write and readback failures both remain visible and direct disable requests to turn off/remove the item', async () => {
  let reads = 0;
  const settings = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    mascotAPI: {
      getLoginItemSettings: async () => {
        reads += 1;
        if (reads > 1) throw new Error('status readback failed');
        return loginStatus(true);
      },
      setLoginItemSettings: async () => { throw new Error('disable rejected'); },
    },
  });
  await settings.api.loadConfiguration();
  await settle();
  settings.api.elements.mascotSize.value = '230';
  settings.api.elements.mascotSize.dispatchEvent({ type: 'input' });
  const saveButtonDisabled = settings.api.elements.saveButton.disabled;
  settings.api.elements.loginAtStartup.checked = false;

  assert.equal(await settings.api.setLoginAtStartup(), false);
  assert.equal(settings.api.state.loginItemKnown, false);
  assert.equal(settings.api.elements.loginAtStartup.disabled, true);
  assert.equal(settings.api.elements.loginAtStartup.checked, true);
  assert.match(settings.api.elements.loginAtStartupStatus.textContent, /disable rejected/);
  assert.match(settings.api.elements.loginAtStartupStatus.textContent, /status readback failed/);
  assert.match(settings.api.elements.loginAtStartupStatus.textContent, /オフにするか、項目を削除/);
  assert.equal(settings.api.state.dirty, true);
  assert.equal(settings.api.elements.saveButton.disabled, saveButtonDisabled);
});

test('preload forwards login-item API calls and the exact caller-provided value', async () => {
  const preload = loadPreloadForTest({ projectRoot: PROJECT_ROOT });
  await preload.api.getLoginItemSettings();
  await preload.api.setLoginItemSettings('not-coerced');
  assert.deepEqual(preload.invoked, [
    { channel: 'mascot:get-login-item-settings', args: [] },
    { channel: 'mascot:set-login-item-settings', args: ['not-coerced'] },
  ]);
});

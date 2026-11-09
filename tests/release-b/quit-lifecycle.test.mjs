import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadMainForTest } from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

function diagnosticsAt(userDataRoot) {
  const filePath = path.join(userDataRoot, 'mascot-diagnostics.log');
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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

function markSettingsDirty(main, window, dirty = true) {
  main.ipcListeners.get('mascot:settings-dirty')(eventForWindow(window), dirty);
}

function assertSafeQuitDiagnostics(rows) {
  const eventNames = new Set([
    'quit-requested',
    'before-quit',
    'will-quit',
    'app-quit',
    'settings-close',
    'quit-confirmation-pending',
    'quit-confirmation-cancelled',
    'quit-confirmation-discarded',
    'quit-confirmation-error',
    'quit-confirmation-window-unavailable',
    'settings-window-closed',
    'mascot-close',
    'mascot-closed',
  ]);
  const allowedKeys = new Set([
    'timestamp',
    'event',
    'processId',
    'quitAttemptSequence',
    'source',
    'decision',
    'dirty',
    'allowClose',
    'promptPending',
    'quitRequested',
    'currentWindow',
  ]);

  for (const entry of rows.filter((row) => eventNames.has(row.event))) {
    assert.ok(Object.keys(entry).every((key) => allowedKeys.has(key)));
    assert.equal(typeof entry.processId, 'number');
    assert.ok(entry.quitAttemptSequence === null || Number.isInteger(entry.quitAttemptSequence));
    if (entry.source) {
      assert.ok(['tray', 'native', 'discard-confirmed', 'unsupported-platform',
        'startup-failure', 'last-window-closed', 'single-instance-lock-denied'].includes(entry.source));
    }
    if (entry.decision) assert.ok(['allow', 'veto', 'edit', 'discard'].includes(entry.decision));
  }
}

test('tray Quit logs its request before calling app.quit and preserves attempt correlation', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    let main;
    let quitCallCount = 0;
    let eventsAtQuitCall = [];
    main = loadMainForTest({
      projectRoot,
      userDataRoot,
      appOverrides: {
        quit() {
          quitCallCount += 1;
          eventsAtQuitCall = diagnosticsAt(userDataRoot).map((entry) => entry.event);
        },
      },
    });

    main.api.createTray();
    const quitItem = main.trayInstances[0].contextMenu.template.find((item) => item.label === '終了');
    assert.equal(quitItem.role, undefined);
    quitItem.click();

    assert.equal(quitCallCount, 1);
    assert.deepEqual(eventsAtQuitCall, ['quit-requested']);
    main.app.emit('before-quit');
    main.app.emit('will-quit');

    const rows = diagnosticsAt(userDataRoot);
    const requested = rows.find((entry) => entry.event === 'quit-requested');
    const beforeQuit = rows.find((entry) => entry.event === 'before-quit');
    const willQuit = rows.find((entry) => entry.event === 'will-quit');
    const legacyQuit = rows.find((entry) => entry.event === 'app-quit');
    assert.equal(requested.source, 'tray');
    assert.equal(requested.processId, process.pid);
    assert.equal(requested.quitAttemptSequence, 1);
    for (const entry of [beforeQuit, willQuit, legacyQuit]) {
      assert.equal(entry.processId, requested.processId);
      assert.equal(entry.quitAttemptSequence, requested.quitAttemptSequence);
    }

    assertSafeQuitDiagnostics(rows);
  });
});

test('native app.quit requests complete and a later quit gets a new sequence', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const main = loadMainForTest({ projectRoot, userDataRoot });

    assert.equal(main.app.quit(), true);
    assert.equal(main.app.quit(), true);

    const requests = diagnosticsAt(userDataRoot).filter((entry) => entry.event === 'quit-requested');
    assert.deepEqual(requests.map((entry) => entry.source), ['native', 'native']);
    assert.deepEqual(requests.map((entry) => entry.quitAttemptSequence), [1, 2]);
    assert.ok(requests.every((entry) => entry.processId === process.pid));
    assert.deepEqual(main.quitState, { calls: 2, completed: 2 });
  });
});

test('dirty app.quit is vetoed before windows close; cancel preserves edits and allows retry', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    let resolvePrompt;
    let promptCount = 0;
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      dialogOverrides: {
        showMessageBox() {
          promptCount += 1;
          return new Promise((resolve) => { resolvePrompt = resolve; });
        },
      },
    });
    main.api.createMascotWindow();
    main.api.openSettingsWindow();
    const settingsWindow = main.browserWindows.at(-1);
    const mascotWindow = main.browserWindows[0];
    markSettingsDirty(main, settingsWindow);

    assert.equal(main.app.quit(), false);
    await nextTurn();
    assert.equal(main.app.quit(), false);
    await nextTurn();
    assert.equal(promptCount, 1);
    assert.equal(settingsWindow.isDestroyed(), false);
    assert.equal(mascotWindow.isDestroyed(), false);
    assert.deepEqual(main.quitState, { calls: 2, completed: 0 });

    let rows = diagnosticsAt(userDataRoot);
    const beforeQuit = rows.filter((entry) => entry.event === 'before-quit');
    assert.equal(beforeQuit.length, 2);
    assert.equal(beforeQuit[0].quitAttemptSequence, 1);
    assert.equal(beforeQuit[1].quitAttemptSequence, 1);
    assert.equal(rows.some((entry) => entry.event === 'mascot-close'), false);
    assert.ok(rows.some((entry) => entry.event === 'quit-confirmation-pending'));

    resolvePrompt({ response: 0 });
    await nextTurn();
    assert.equal(settingsWindow.isDestroyed(), false);
    assert.equal(settingsWindow.isVisible(), true);
    assert.equal(mascotWindow.isDestroyed(), false);
    assert.equal(main.api.getSettingsDirty(), true);
    assert.equal(typeof main.app.exit, 'undefined');

    assert.equal(main.app.quit(), false);
    await nextTurn();
    assert.equal(promptCount, 2);
    resolvePrompt({ response: 0 });
    await nextTurn();

    rows = diagnosticsAt(userDataRoot);
    assertSafeQuitDiagnostics(rows);
    const cancelled = rows.filter((entry) => entry.event === 'quit-confirmation-cancelled');
    assert.deepEqual(cancelled.map((entry) => entry.decision), ['edit', 'edit']);
    assert.deepEqual(cancelled.map((entry) => entry.quitAttemptSequence), [1, 2]);
    assert.equal(settingsWindow.isDestroyed(), false);
    assert.equal(mascotWindow.isDestroyed(), false);
    assert.deepEqual(main.quitState, { calls: 3, completed: 0 });
    assert.equal(main.api.getSettingsDirty(), true);
  });
});

test('cancelling a dirty quit during an async diagnostic write does not retry the cancelled quit', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    let resolvePrompt;
    let promptCount = 0;
    let releaseOpen;
    let notifyOpenStarted;
    const openStarted = new Promise((resolve) => { notifyOpenStarted = resolve; });
    const openGate = new Promise((resolve) => { releaseOpen = resolve; });
    const promises = new Proxy(fs.promises, {
      get(target, property) {
        if (property === 'open') {
          return async (...args) => {
            notifyOpenStarted();
            await openGate;
            return target.open(...args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      fsOverrides: { promises },
      dialogOverrides: {
        showMessageBox() {
          promptCount += 1;
          return new Promise((resolve) => { resolvePrompt = resolve; });
        },
      },
    });
    main.api.createMascotWindow();
    main.api.openSettingsWindow();
    const settingsWindow = main.browserWindows.at(-1);
    const mascotWindow = main.browserWindows[0];
    markSettingsDirty(main, settingsWindow);
    for (let index = 0; index < 20; index += 1) {
      main.api.recordDiagnostic('pending-write-test', { index });
    }
    await openStarted;

    assert.equal(main.app.quit(), false);
    await nextTurn();
    assert.equal(promptCount, 1);
    resolvePrompt({ response: 0 });
    await nextTurn();
    assert.equal(settingsWindow.isDestroyed(), false);
    assert.equal(mascotWindow.isDestroyed(), false);

    releaseOpen();
    await main.api.flushDiagnostics();
    await nextTurn();
    assert.equal(promptCount, 1);
    assert.equal(main.quitState.calls, 1);
    assert.equal(settingsWindow.isDestroyed(), false);
    assert.equal(mascotWindow.isDestroyed(), false);
  });
});

test('settings dirty=false permits clean app.quit without a discard prompt', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    let promptCount = 0;
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      dialogOverrides: {
        showMessageBox() {
          promptCount += 1;
          return Promise.resolve({ response: 0 });
        },
      },
    });
    main.api.createMascotWindow();
    main.api.openSettingsWindow();
    const settingsWindow = main.browserWindows.at(-1);
    markSettingsDirty(main, settingsWindow);
    markSettingsDirty(main, settingsWindow, false);

    assert.equal(main.app.quit(), true);
    assert.equal(promptCount, 0);
    assert.equal(main.quitState.completed, 1);
    assert.equal(main.api.getSettingsDirty(), false);
    assert.ok(diagnosticsAt(userDataRoot).some((entry) => (
      entry.event === 'settings-close' && entry.decision === 'allow' && entry.dirty === false
    )));
  });
});

test('discard is explicit and retries app.quit within the same attempt', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    let resolvePrompt;
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      dialogOverrides: {
        showMessageBox() {
          return new Promise((resolve) => { resolvePrompt = resolve; });
        },
      },
    });
    main.api.createMascotWindow();
    main.api.openSettingsWindow();
    const settingsWindow = main.browserWindows.at(-1);
    markSettingsDirty(main, settingsWindow);

    assert.equal(main.app.quit(), false);
    await nextTurn();
    resolvePrompt({ response: 1 });
    await nextTurn();

    assert.equal(settingsWindow.isDestroyed(), true);
    assert.equal(main.api.getSettingsDirty(), false);
    assert.deepEqual(main.quitState, { calls: 2, completed: 1 });
    assert.equal(main.browserWindows[0].isDestroyed(), true);
    const rows = diagnosticsAt(userDataRoot);
    assertSafeQuitDiagnostics(rows);
    const attemptRows = rows.filter((entry) => entry.quitAttemptSequence === 1);
    assert.ok(attemptRows.some((entry) => entry.event === 'quit-confirmation-discarded'));
    assert.ok(attemptRows.some((entry) => (
      entry.event === 'quit-requested' && entry.source === 'discard-confirmed'
    )));
    assert.ok(attemptRows.some((entry) => entry.event === 'will-quit'));
    assert.ok(attemptRows.every((entry) => entry.processId === process.pid));
    assert.equal(typeof main.app.exit, 'undefined');
  });
});

test('dialog rejection is logged without discarding settings and allows a fresh attempt', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    let promptCount = 0;
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      dialogOverrides: {
        showMessageBox() {
          promptCount += 1;
          return Promise.reject(new Error('private dialog detail'));
        },
      },
    });
    main.api.createMascotWindow();
    main.api.openSettingsWindow();
    const settingsWindow = main.browserWindows.at(-1);
    const mascotWindow = main.browserWindows[0];
    markSettingsDirty(main, settingsWindow);

    assert.equal(main.app.quit(), false);
    await nextTurn();
    await nextTurn();
    assert.equal(settingsWindow.isDestroyed(), false);
    assert.equal(mascotWindow.isDestroyed(), false);
    assert.equal(main.api.getSettingsDirty(), true);
    assert.equal(main.errorBoxes.length, 1);

    assert.equal(main.app.quit(), false);
    await nextTurn();
    await nextTurn();
    assert.equal(promptCount, 2);

    main.api.flushDiagnosticsSync();
    const contents = fs.readFileSync(path.join(userDataRoot, 'mascot-diagnostics.log'), 'utf8');
    assert.equal(contents.includes('private dialog detail'), false);
    const errors = diagnosticsAt(userDataRoot).filter((entry) => entry.event === 'quit-confirmation-error');
    assert.deepEqual(errors.map((entry) => entry.quitAttemptSequence), [1, 2]);
    assertSafeQuitDiagnostics(diagnosticsAt(userDataRoot));
  });
});

test('discard from a settings red-X close does not quit the application', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    let resolvePrompt;
    let quitCallCount = 0;
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      appOverrides: { quit() { quitCallCount += 1; } },
      dialogOverrides: {
        showMessageBox() {
          return new Promise((resolve) => { resolvePrompt = resolve; });
        },
      },
    });
    main.api.openSettingsWindow();
    const settingsWindow = main.browserWindows.at(-1);
    markSettingsDirty(main, settingsWindow);

    assert.equal(settingsWindow.close(), false);
    await nextTurn();
    resolvePrompt({ response: 1 });
    await nextTurn();

    assert.equal(settingsWindow.isDestroyed(), true);
    assert.equal(quitCallCount, 0);
    assert.equal(main.quitState.calls, 0);
    const rows = diagnosticsAt(userDataRoot);
    assert.ok(rows.some((entry) => (
      entry.event === 'quit-confirmation-discarded'
      && entry.quitAttemptSequence === null
    )));
    assertSafeQuitDiagnostics(rows);
  });
});

test('diagnostic write failures do not block the explicit tray quit request', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    let quitCallCount = 0;
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      fsOverrides: {
        appendFileSync() { throw new Error('simulated diagnostic failure'); },
      },
      appOverrides: { quit() { quitCallCount += 1; } },
    });

    main.api.createTray();
    main.trayInstances[0].contextMenu.template.find((item) => item.label === '終了').click();

    assert.equal(quitCallCount, 1);
  });
});

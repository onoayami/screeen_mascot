import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  loadMainForTest,
  loadPreloadForTest,
  loadRendererForTest,
} from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

function createFakeTimers() {
  const timeouts = [];
  const intervals = [];
  return {
    timeouts,
    intervals,
    setTimeout(callback, delay) {
      const timer = {
        callback,
        delay,
        cleared: false,
        unreferenced: false,
        unref() { this.unreferenced = true; },
      };
      timeouts.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
    setInterval(callback, delay) {
      const timer = {
        callback,
        delay,
        cleared: false,
        unreferenced: false,
        unref() { this.unreferenced = true; },
      };
      intervals.push(timer);
      return timer;
    },
    clearInterval(timer) {
      if (timer) timer.cleared = true;
    },
    run(timer) {
      if (!timer.cleared) timer.callback();
    },
  };
}

function createDisplay() {
  return {
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    workArea: { x: 0, y: 0, width: 800, height: 560 },
  };
}

function loadMain(projectRoot, userDataRoot, timers = createFakeTimers(), overrides = {}) {
  const display = createDisplay();
  const main = loadMainForTest({
    projectRoot,
    userDataRoot,
    timerOverrides: timers,
    screenOverrides: {
      getAllDisplays: () => [display],
      getDisplayNearestPoint: () => display,
      ...overrides.screenOverrides,
    },
    ...overrides,
  });
  return { main, display, timers };
}

function makeAction(id, name) {
  return {
    _uiId: id,
    name,
    assetUrl: `file:///dummy/${id}.svg`,
    imageTransform: { scale: 1, offsetX: 0, offsetY: 0 },
    movement: { type: 'still', speed: 0 },
    durationMs: [6000, 10000],
    weight: 1,
  };
}

test('renderer crashes and main-frame load failures trigger bounded recovery', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const { main, timers } = loadMain(projectRoot, userDataRoot);
    main.api.createMascotWindow();
    const window = main.browserWindows.at(-1);

    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(window.webContents.reloadCount, 1);
    window.webContents.emit('did-fail-load', {}, -3, 'failed', '', false);
    assert.equal(window.webContents.reloadCount, 1);
    window.webContents.emit('did-fail-load', {}, -3, 'failed', '', true);
    assert.equal(main.errorBoxes.length, 0);
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(main.errorBoxes.length, 0);
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(main.errorBoxes.length, 1);
    assert.equal(window.webContents.reloadCount, 1);

    window.webContents.emit('did-finish-load');
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    const cooldownTimer = timers.timeouts.find((timer) => (
      timer.unreferenced
      && timer.delay > 0
      && timer.delay <= main.api.RECOVERY_TIMING.rendererReloadCooldownMs
    ));
    assert.ok(
      cooldownTimer.delay > 0
      && cooldownTimer.delay <= main.api.RECOVERY_TIMING.rendererReloadCooldownMs,
    );
    assert.equal(cooldownTimer.unreferenced, true);
    assert.equal(window.webContents.reloadCount, 1);
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(main.errorBoxes.length, 1);
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(main.errorBoxes.length, 2);
  });
});

test('aborted main-frame loads are ignored and other load errors are diagnosed', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const { main } = loadMain(projectRoot, userDataRoot);
    main.api.createMascotWindow();
    const window = main.browserWindows.at(-1);
    window.webContents.emit('did-fail-load', {}, -3, 'aborted', '', true);
    main.api.flushDiagnosticsSync();
    assert.equal(window.webContents.reloadCount, 0);
    const logPath = path.join(userDataRoot, 'mascot-diagnostics.log');
    assert.equal(fs.existsSync(logPath), false);

    window.webContents.emit('did-fail-load', {}, -2, 'failed', '', true);
    main.api.flushDiagnosticsSync();
    const entries = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(entries.some((entry) => entry.event === 'did-fail-load' && entry.errorCode === -2));
    assert.equal(window.webContents.reloadCount, 1);
  });
});

test('diagnostic batches flush in order and pending entries are written before quit', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const { main } = loadMain(projectRoot, userDataRoot);
    const logPath = path.join(userDataRoot, 'mascot-diagnostics.log');
    main.api.recordDiagnostic('batch-one');
    main.api.recordDiagnostic('batch-two');
    assert.equal(fs.existsSync(logPath), false);
    assert.equal(await main.api.flushDiagnostics(), true);
    assert.deepEqual(
      fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line).event),
      ['batch-one', 'batch-two'],
    );

    main.api.recordDiagnostic('pending-at-quit');
    main.app.quit();
    const events = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line).event);
    assert.equal(events.filter((event) => event === 'pending-at-quit').length, 1);
    assert.ok(events.includes('before-quit'));
    assert.ok(events.includes('app-quit'));
  });
});

test('pointer synchronization suppresses duplicates but keeps a recovery heartbeat', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    let cursor = { x: 110, y: 220 };
    const { main } = loadMain(projectRoot, userDataRoot, createFakeTimers(), {
      screenOverrides: { getCursorScreenPoint: () => cursor },
    });
    let now = 1000;
    main.context.Date = class TestDate extends Date {
      static now() { return now; }
    };
    main.api.createMascotWindow();
    const window = main.browserWindows.at(-1);
    const countSyncCommands = () => window.webContents.sent.filter(
      ({ payload }) => payload?.command === 'sync-pointer-position',
    ).length;

    main.api.synchronizeMascotPassthrough();
    assert.equal(countSyncCommands(), 1);
    main.api.synchronizeMascotPassthrough();
    assert.equal(countSyncCommands(), 1);

    cursor = { x: 111, y: 220 };
    main.api.synchronizeMascotPassthrough();
    assert.equal(countSyncCommands(), 2);
    now += 5000;
    main.api.synchronizeMascotPassthrough();
    assert.equal(countSyncCommands(), 3);

    window.webContents.emit('did-finish-load');
    assert.equal(countSyncCommands(), 4);
  });
});

test('screen recovery attaches only one pending did-finish-load notification', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const { main } = loadMain(projectRoot, userDataRoot);
    main.api.createMascotWindow();
    const window = main.browserWindows.at(-1);
    window.webContents.loading = true;
    main.api.ensureMascotWindowOnScreen();
    main.api.ensureMascotWindowOnScreen({ centerMascot: true });
    const pending = window.webContents.listeners.get('did-finish-load')
      .filter((entry) => entry.once);
    assert.equal(pending.length, 1);
    window.webContents.emit('did-finish-load');
    assert.equal(window.webContents.listeners.get('did-finish-load').some((entry) => entry.once), false);
  });
});

test('unresponsive windows reload only if they do not recover before the timeout', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const timers = createFakeTimers();
    const { main } = loadMain(projectRoot, userDataRoot, timers);
    main.api.createMascotWindow();
    const window = main.browserWindows.at(-1);

    window.emit('unresponsive');
    const recoveredTimer = timers.timeouts.at(-1);
    assert.equal(recoveredTimer.delay, main.api.RECOVERY_TIMING.unresponsiveTimeoutMs);
    assert.equal(recoveredTimer.unreferenced, true);
    window.emit('responsive');
    timers.run(recoveredTimer);
    assert.equal(window.webContents.reloadCount, 0);

    window.emit('unresponsive');
    timers.run(timers.timeouts.at(-1));
    assert.equal(window.webContents.reloadCount, 1);
  });
});

test('watchdog repairs off-screen windows without undoing an intentional tray hide', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const { main } = loadMain(projectRoot, userDataRoot);
    main.api.createMascotWindow();
    const window = main.browserWindows.at(-1);
    window.setBounds({ x: 2400, y: 1400, width: 300, height: 300 });

    assert.equal(main.api.runMascotWatchdog('test-off-screen'), true);
    assert.deepEqual(window.getBounds(), createDisplay().workArea);
    assert.equal(window.isVisible(), true);

    main.api.toggleVisibility();
    assert.equal(main.api.isMascotHiddenByUser(), true);
    assert.equal(window.isVisible(), false);
    window.setBounds({ x: 2400, y: 1400, width: 300, height: 300 });
    main.api.runMascotWatchdog('test-hidden');
    assert.equal(window.isVisible(), false);
    assert.deepEqual(window.getBounds(), createDisplay().workArea);
  });
});

test('watchdog backs off repeated repairs by kind and resumes after the cooldown', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const timers = createFakeTimers();
    const { main } = loadMain(projectRoot, userDataRoot, timers);
    main.api.RECOVERY_TIMING.watchdogRepairLimit = 5;
    main.api.RECOVERY_TIMING.watchdogRepairWindowMs = 60000;
    main.api.RECOVERY_TIMING.watchdogRepairCooldownMs = 300;
    main.api.createMascotWindow();
    const window = main.browserWindows.at(-1);
    const offscreenBounds = { x: 2400, y: 1400, width: 300, height: 300 };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      window.setBounds(offscreenBounds);
      assert.equal(main.api.runMascotWatchdog('repeated-bounds-test'), true);
      assert.deepEqual(window.getBounds(), createDisplay().workArea);
    }

    window.setBounds(offscreenBounds);
    assert.equal(main.api.runMascotWatchdog('repeated-bounds-test'), false);
    assert.deepEqual(window.getBounds(), offscreenBounds);
    main.api.flushDiagnosticsSync();
    let entries = fs.readFileSync(path.join(userDataRoot, 'mascot-diagnostics.log'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(entries.filter((entry) => entry.event === 'watchdog-repaired').length, 5);
    assert.deepEqual(
      entries.filter((entry) => entry.event === 'watchdog-backoff').map((entry) => ({
        repair: entry.repair,
        count: entry.count,
        windowMs: entry.windowMs,
        cooldownMs: entry.cooldownMs,
      })),
      [{
        repair: 'outside-displays',
        count: 6,
        windowMs: 60000,
        cooldownMs: 300,
      }],
    );

    const logWhileBlocked = fs.readFileSync(
      path.join(userDataRoot, 'mascot-diagnostics.log'),
      'utf8',
    );
    window.setBounds(offscreenBounds);
    assert.equal(main.api.runMascotWatchdog('still-backed-off-test'), false);
    assert.equal(
      fs.readFileSync(path.join(userDataRoot, 'mascot-diagnostics.log'), 'utf8'),
      logWhileBlocked,
    );

    window.setAlwaysOnTop(false);
    assert.equal(main.api.runMascotWatchdog('unrelated-repair-test'), true);
    assert.deepEqual(window.getBounds(), offscreenBounds);
    assert.equal(window.isAlwaysOnTop(), true);
    main.api.flushDiagnosticsSync();
    entries = fs.readFileSync(path.join(userDataRoot, 'mascot-diagnostics.log'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.deepEqual(
      entries.filter((entry) => entry.event === 'watchdog-repaired').at(-1).repairs,
      ['always-on-top'],
    );
    assert.equal(entries.filter((entry) => entry.event === 'watchdog-backoff').length, 1);

    const cooldown = timers.timeouts.find(
      (timer) => timer.delay === main.api.RECOVERY_TIMING.watchdogRepairCooldownMs,
    );
    assert.ok(cooldown);
    assert.equal(cooldown.unreferenced, true);
    timers.run(cooldown);
    window.setBounds(offscreenBounds);
    assert.equal(main.api.runMascotWatchdog('after-backoff-test'), true);
    assert.deepEqual(window.getBounds(), createDisplay().workArea);

    main.api.RECOVERY_TIMING.watchdogRepairWindowMs = 10;
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      window.setBounds(offscreenBounds);
      assert.equal(main.api.runMascotWatchdog('expired-window-test'), true);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    entries = fs.readFileSync(path.join(userDataRoot, 'mascot-diagnostics.log'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(entries.filter((entry) => entry.event === 'watchdog-backoff').length, 1);
  });
});

test('watchdog treats subpixel work-area differences as a match without logging', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const { main, display } = loadMain(projectRoot, userDataRoot);
    main.api.createMascotWindow();
    const window = main.browserWindows.at(-1);
    await main.api.flushDiagnostics();
    const logPath = path.join(userDataRoot, 'mascot-diagnostics.log');
    const readLog = () => fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    const logBeforeWatchdog = readLog();
    window.setBounds({ x: 0.5, y: 0.5, width: 799.5, height: 559.5 });

    assert.equal(main.api.runMascotWatchdog('subpixel-bounds-test'), false);
    assert.deepEqual(window.getBounds(), {
      x: 0.5,
      y: 0.5,
      width: 799.5,
      height: 559.5,
    });
    await main.api.flushDiagnostics();
    assert.equal(readLog(), logBeforeWatchdog);

    window.setBounds({ ...display.workArea, x: display.workArea.x + 1 });
    assert.equal(main.api.runMascotWatchdog('one-pixel-bounds-test'), true);
    assert.deepEqual(window.getBounds(), display.workArea);
    await main.api.flushDiagnostics();
    const entries = readLog().trim().split('\n').map(JSON.parse);
    assert.equal(entries.filter((entry) => entry.event === 'watchdog-repaired').length, 1);
  });
});

test('diagnostic write failures warn without preventing window recovery', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const { main } = loadMain(projectRoot, userDataRoot, undefined, {
      fsOverrides: {
        promises: new Proxy(fs.promises, {
          get(target, property) {
            if (property === 'open') return async () => { throw new Error('disk full'); };
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }),
      },
    });
    main.api.createMascotWindow();
    const window = main.browserWindows.at(-1);
    window.setBounds({ x: 2400, y: 1400, width: 300, height: 300 });

    assert.doesNotThrow(() => main.api.runMascotWatchdog('write-failure-test'));
    assert.equal(await main.api.flushDiagnostics(), false);
    assert.deepEqual(window.getBounds(), createDisplay().workArea);
  });
});

test('resume, unlock, and display changes schedule delayed, unreferenced repairs', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const timers = createFakeTimers();
    const { main, display } = loadMain(projectRoot, userDataRoot, timers);
    main.api.RECOVERY_TIMING.recoveryDelayMs = 80;
    main.api.createMascotWindow();
    const window = main.browserWindows.at(-1);
    main.api.startMascotRecoveryMonitoring();

    assert.equal(timers.intervals.at(-1).delay, 2000);
    assert.equal(timers.intervals.at(-1).unreferenced, true);
    for (const [source, emit] of [
      ['resume', () => main.electron.powerMonitor.emit('resume')],
      ['unlock-screen', () => main.electron.powerMonitor.emit('unlock-screen')],
      ['display-metrics-changed', () => main.electron.screen.emit('display-metrics-changed')],
    ]) {
      window.setBounds({ x: 2400, y: 1400, width: 300, height: 300 });
      emit();
      const timer = timers.timeouts.at(-1);
      assert.equal(timer.delay, 80, source);
      assert.equal(timer.unreferenced, true, source);
      timers.run(timer);
      assert.deepEqual(window.getBounds(), display.workArea, source);
    }
  });
});

test('settings hide and destruction restore floating always-on-top', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const { main } = loadMain(projectRoot, userDataRoot);
    main.api.createMascotWindow();
    const mascotWindow = main.browserWindows.at(-1);

    main.api.openSettingsWindow();
    const settingsWindow = main.browserWindows.at(-1);
    assert.equal(mascotWindow.isAlwaysOnTop(), false);
    settingsWindow.hide();
    assert.equal(mascotWindow.isAlwaysOnTop(), true);
    assert.equal(mascotWindow.alwaysOnTopCalls.at(-1).level, 'floating');

    main.api.openSettingsWindow();
    assert.equal(mascotWindow.isAlwaysOnTop(), false);
    settingsWindow.destroy();
    assert.equal(mascotWindow.isAlwaysOnTop(), true);
    assert.equal(main.api.getSettingsDirty(), false);
  });
});

test('NaN positions are centered and clamped, including a zero-sized viewport', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot, width: 800, height: 600 });
    renderer.api.state.config = { mascot: { size: 180 } };
    renderer.api.state.position = { x: Number.NaN, y: Number.POSITIVE_INFINITY };

    renderer.api.ensureMascotVisible();
    assert.equal(renderer.api.state.position.x, 310);
    assert.equal(renderer.api.state.position.y, 210);
    assert.ok(Number.isFinite(renderer.api.state.position.x));
    assert.ok(Number.isFinite(renderer.api.state.position.y));

    const zeroViewport = loadRendererForTest({ projectRoot, width: 0, height: 0 });
    zeroViewport.api.state.config = { mascot: { size: 180 } };
    zeroViewport.api.state.position = { x: Number.NaN, y: Number.NaN };
    zeroViewport.api.ensureMascotVisible();
    assert.equal(zeroViewport.api.state.position.x, 0);
    assert.equal(zeroViewport.api.state.position.y, 0);
  });
});

test('large image offsets can move image content outside the mascot frame', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot });
    renderer.api.state.config = { mascot: { size: 180 } };
    renderer.api.setAction({
      ...makeAction('outside', 'outside'),
      imageTransform: { scale: 0.3, offsetX: 100, offsetY: -100 },
    });

    const imageStyle = renderer.nodes.get('mascot-image').style;
    assert.equal(imageStyle['--image-scale'], '0.3');
    assert.equal(imageStyle['--image-offset-x'], '100%');
    assert.equal(imageStyle['--image-offset-y'], '-100%');
  });
});

test('image load errors move to another action and report sanitized renderer diagnostics', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const reported = [];
    const renderer = loadRendererForTest({
      projectRoot,
      mascotAPI: { reportDiagnostic(type) { reported.push(type); } },
    });
    const first = makeAction('first', 'first');
    const second = makeAction('second', 'second');
    renderer.api.state.config = { name: 'dummy', mascot: { size: 180 } };
    renderer.api.state.actions = [first, second];
    renderer.api.state.currentAction = first;
    renderer.nodes.get('mascot-image').dispatchEvent({ type: 'error' });

    assert.equal(renderer.api.state.currentAction, second);
    assert.deepEqual([...renderer.api.failedActionIds], ['first']);
    assert.equal(reported[0], 'image-load-failed');
    assert.match(renderer.nodes.get('status').textContent, /画像を表示できません/);

    renderer.window.dispatch('error');
    renderer.window.dispatch('unhandledrejection');
    assert.deepEqual(reported, ['image-load-failed', 'window-error', 'unhandled-rejection']);

    const singleAction = loadRendererForTest({
      projectRoot,
      mascotAPI: { reportDiagnostic(type) { reported.push(type); } },
    });
    const onlyAction = makeAction('only', 'only');
    singleAction.api.state.config = { mascot: { size: 180 } };
    singleAction.api.state.actions = [onlyAction];
    singleAction.api.state.currentAction = onlyAction;
    singleAction.nodes.get('mascot-image').dispatchEvent({ type: 'error' });
    assert.equal(singleAction.api.state.currentAction, onlyAction);
  });
});

test('runtime action identities isolate failed images and retry empty action sets without spinning', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    class AutoLoadingImage {
      constructor() {
        this.naturalWidth = 1;
        this.naturalHeight = 1;
      }

      set src(_value) {
        this.onload?.();
      }
    }
    const renderer = loadRendererForTest({
      projectRoot,
      ImageClass: AutoLoadingImage,
      mascotAPI: { resolveAsset: async (file) => `file:///${file}` },
    });
    const first = await renderer.api.resolveAction({
      name: 'first',
      file: 'actions/first.svg',
      movement: { type: 'still', speed: 0 },
      durationMs: [6000, 10000],
    }, 0);
    const second = await renderer.api.resolveAction({
      name: 'second',
      file: 'actions/second.svg',
      movement: { type: 'still', speed: 0 },
      durationMs: [6000, 10000],
    }, 1);
    assert.notEqual(first._uiId, second._uiId);
    renderer.api.state.config = { name: 'test', mascot: { size: 180 } };
    renderer.api.state.actions = [first, second];
    renderer.api.state.currentAction = first;
    renderer.nodes.get('mascot-image').dispatchEvent({ type: 'error' });
    assert.equal(renderer.api.state.currentAction, second);
    assert.deepEqual([...renderer.api.failedActionIds], [first._uiId]);

    renderer.api.state.currentAction = first;
    renderer.nodes.get('mascot-image').dispatchEvent({ type: 'load' });
    assert.equal(renderer.api.failedActionIds.has(first._uiId), false);

    renderer.api.failedActionIds.add(first._uiId);
    renderer.api.failedActionIds.add(second._uiId);
    renderer.api.state.currentAction = second;
    renderer.api.state.nextActionAt = 0;
    renderer.api.updateMotion(100, 0.016);
    assert.equal(renderer.api.state.nextActionAt, 1100);
    renderer.api.updateMotion(500, 0.016);
    assert.equal(renderer.api.state.nextActionAt, 1100);
    assert.equal(renderer.api.chooseWeightedAction(), null);
  });
});

test('diagnostic logs rotate at 1 MiB and trusted IPC records no caller-supplied details', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const { main } = loadMain(projectRoot, userDataRoot);
    const logPath = path.join(userDataRoot, 'mascot-diagnostics.log');
    const oldLogPath = path.join(userDataRoot, 'mascot-diagnostics.old.log');
    const largeLog = 'x'.repeat(1024 * 1024 + 1);
    fs.writeFileSync(logPath, largeLog, 'utf8');

    main.api.recordDiagnostic('rotation-test');
    assert.equal(main.api.flushDiagnosticsSync(), true);
    assert.equal(fs.readFileSync(oldLogPath, 'utf8'), largeLog);
    const logLine = fs.readFileSync(logPath, 'utf8').trim();
    assert.equal(JSON.parse(logLine).event, 'rotation-test');

    main.api.createMascotWindow();
    const mascotWindow = main.browserWindows.at(-1);
    const trustedEvent = {
      sender: mascotWindow.webContents,
      senderFrame: mascotWindow.webContents.mainFrame,
    };
    const report = main.ipcListeners.get('mascot:diagnostic');
    report(trustedEvent, 'window-error');
    report(trustedEvent, {
      type: 'window-error',
      message: '/Users/private/config.json secret mascot settings',
    });
    report({ ...trustedEvent, senderFrame: { url: 'https://untrusted.invalid/' } }, 'window-error');
    await main.api.flushDiagnostics();
    const entries = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[1], {
      timestamp: entries[1].timestamp,
      event: 'renderer-error',
      kind: 'window-error',
    });
    assert.doesNotMatch(fs.readFileSync(logPath, 'utf8'), /private|config\.json|secret|untrusted/);

    main.api.createTray();
    main.api.rebuildTrayMenu();
    const diagnosticItem = main.trayInstances[0].contextMenu.template.find(
      (item) => item.label === '診断ログを開く',
    );
    assert.ok(diagnosticItem);
    diagnosticItem.click();
    assert.deepEqual(main.shownItems, [logPath]);
  });
});

test('mascot preload exposes the diagnostic IPC sender', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const preload = loadPreloadForTest({ projectRoot, fileName: 'preload-mascot.js' });
    preload.api.reportDiagnostic('window-error');
    assert.deepEqual(preload.sent.at(-1), {
      channel: 'mascot:diagnostic',
      args: ['window-error'],
    });
  });
});

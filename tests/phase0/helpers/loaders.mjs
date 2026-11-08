import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createDomStub, createWindowEventTarget } from './dom-stub.mjs';

const hostRequire = createRequire(import.meta.url);

function runScript(source, context, filename) {
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename });
  return context.__phase0;
}

export function loadMainForTest({
  projectRoot,
  userDataRoot,
  fsOverrides = {},
  appOverrides = {},
  screenOverrides = {},
  dialogOverrides = {},
  nativeImageOverrides = {},
  timerOverrides = {},
} = {}) {
  const handlers = new Map();
  const ipcListeners = new Map();
  const errorBoxes = [];
  const shownItems = [];
  const menus = [];
  const trayInstances = [];
  const screenListeners = new Map();
  const powerMonitorListeners = new Map();
  const projectRequire = createRequire(path.join(projectRoot, 'main.js'));
  const wrappedFs = new Proxy(fs, {
    get(target, property) {
      if (Object.prototype.hasOwnProperty.call(fsOverrides, property)) return fsOverrides[property];
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  const app = {
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    quit() {},
    getPath: () => userDataRoot,
    whenReady: () => new Promise(() => {}),
    on() {},
    ...appOverrides,
  };

  const browserWindows = [];
  let nextWebContentsId = 1000;

  class FakeWebContents {
    constructor(owner) {
      this.owner = owner;
      this.id = nextWebContentsId;
      nextWebContentsId += 1;
      this.mainFrame = { url: 'about:blank' };
      this.listeners = new Map();
      this.sent = [];
      this.windowOpenHandler = null;
      this.loading = false;
      this.reloadCount = 0;
    }

    on(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({ listener, once: false });
    }

    once(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({ listener, once: true });
    }

    emit(type, ...args) {
      const current = [...(this.listeners.get(type) || [])];
      this.listeners.set(type, current.filter((entry) => !entry.once));
      current.forEach((entry) => entry.listener(...args));
    }

    removeListener(type, listener) {
      const current = this.listeners.get(type) || [];
      this.listeners.set(type, current.filter((entry) => entry.listener !== listener));
    }

    send(channel, payload) { this.sent.push({ channel, payload }); }
    isDestroyed() { return this.owner.isDestroyed(); }
    isLoading() { return this.loading; }
    reload() {
      this.reloadCount += 1;
      this.loading = true;
    }
    setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
  }

  class FakeBrowserWindow {
    constructor(options = {}) {
      this.options = options;
      this.destroyed = false;
      this.visible = true;
      this.listeners = new Map();
      this.ignoreMouseCalls = [];
      this.alwaysOnTop = Boolean(options.alwaysOnTop);
      this.alwaysOnTopCalls = [];
      this.setBoundsCalls = [];
      this.bounds = {
        x: options.x || 0,
        y: options.y || 0,
        width: options.width || 800,
        height: options.height || 600,
      };
      this.webContents = new FakeWebContents(this);
      browserWindows.push(this);
    }

    static fromWebContents(webContents) {
      return browserWindows.find((window) => window.webContents === webContents) || null;
    }

    loadFile(fileName) {
      this.loadedFile = fileName;
      this.webContents.mainFrame = {
        url: pathToFileURL(path.join(projectRoot, fileName)).href,
      };
      return Promise.resolve();
    }

    on(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }

    emit(type, ...args) {
      for (const listener of this.listeners.get(type) || []) listener(...args);
    }

    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isAlwaysOnTop() { return this.alwaysOnTop; }
    show() { this.visible = true; this.emit('show'); }
    showInactive() { this.visible = true; this.emit('show'); }
    hide() { this.visible = false; this.emit('hide'); }
    focus() {}
    setAlwaysOnTop(value, level) {
      this.alwaysOnTop = Boolean(value);
      this.alwaysOnTopCalls.push({ value: Boolean(value), level });
    }
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents(ignore, options) { this.ignoreMouseCalls.push({ ignore, options }); }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) {
      this.bounds = { ...bounds };
      this.setBoundsCalls.push({ ...bounds });
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.visible = false;
      this.webContents.emit('destroyed');
      this.emit('closed');
    }
    close() {
      let prevented = false;
      this.emit('close', { preventDefault() { prevented = true; } });
      if (prevented) return false;
      this.destroyed = true;
      this.visible = false;
      this.emit('closed');
      return true;
    }
  }

  const fakeSetTimeout = timerOverrides.setTimeout || setTimeout;
  const fakeClearTimeout = timerOverrides.clearTimeout || clearTimeout;
  const fakeSetInterval = timerOverrides.setInterval || setInterval;
  const fakeClearInterval = timerOverrides.clearInterval || clearInterval;
  const screenEmitter = {
    getAllDisplays: () => [],
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 800, height: 600 } }),
    on(type, listener) {
      if (!screenListeners.has(type)) screenListeners.set(type, []);
      screenListeners.get(type).push(listener);
    },
    emit(type, ...args) {
      for (const listener of screenListeners.get(type) || []) listener(...args);
    },
    ...screenOverrides,
  };
  const powerMonitor = {
    on(type, listener) {
      if (!powerMonitorListeners.has(type)) powerMonitorListeners.set(type, []);
      powerMonitorListeners.get(type).push(listener);
    },
    emit(type, ...args) {
      for (const listener of powerMonitorListeners.get(type) || []) listener(...args);
    },
  };
  const fakeShell = {
    openPath() {},
    showItemInFolder(filePath) { shownItems.push(filePath); },
  };

  const electron = {
    app,
    BrowserWindow: FakeBrowserWindow,
    Menu: {
      setApplicationMenu() {},
      buildFromTemplate(template) {
        const menu = { template };
        menus.push(menu);
        return menu;
      },
    },
    Tray: class FakeTray {
      constructor() {
        trayInstances.push(this);
      }

      setTitle(value) { this.title = value; }
      setToolTip(value) { this.tooltip = value; }
      setContextMenu(menu) { this.contextMenu = menu; }
    },
    nativeImage: {
      createEmpty() { return {}; },
      createFromPath() { return { isEmpty() { return false; } }; },
      ...nativeImageOverrides,
    },
    ipcMain: {
      handle(name, callback) { handlers.set(name, callback); },
      on(name, callback) { ipcListeners.set(name, callback); },
    },
    dialog: {
      async showOpenDialog() { return { canceled: true, filePaths: [] }; },
      async showMessageBox() { return { response: 0 }; },
      showErrorBox(...args) { errorBoxes.push(args); },
      ...dialogOverrides,
    },
    shell: fakeShell,
    screen: screenEmitter,
    powerMonitor,
  };

  const context = {
    console,
    process,
    Buffer,
    URL,
    Promise,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    setInterval: fakeSetInterval,
    clearInterval: fakeClearInterval,
    queueMicrotask,
    require(id) {
      if (id === 'electron') return electron;
      if (id === 'fs') return wrappedFs;
      if (id.startsWith('./') || id.startsWith('../')) return projectRequire(id);
      return hostRequire(id);
    },
    __dirname: projectRoot,
    __filename: path.join(projectRoot, 'main.js'),
    module: { exports: {} },
    exports: {},
  };

  const source = `${fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8')}\n;globalThis.__phase0 = {
    getCharacterDirectory,
    getBundledCharacterDirectory,
    ensureCharacterDirectory,
    recoverDevelopmentDistributionDefaults,
    prepareDistributionDefaultsForDevelopment,
    loadWindowFileWithRecovery,
    reportStartupFailure,
    resolveCharacterPath,
    resolveCharacterAsset,
    validateAndNormalizeConfig,
    writeConfigAtomic,
    loadNormalizedConfig,
    loadEditableConfig: typeof loadEditableConfig === 'function' ? loadEditableConfig : undefined,
    recoverEditableConfig: typeof recoverEditableConfig === 'function' ? recoverEditableConfig : undefined,
    hashNormalizedConfig: typeof hashNormalizedConfig === 'function' ? hashNormalizedConfig : undefined,
    getCharacterAssetMetadata: typeof getCharacterAssetMetadata === 'function' ? getCharacterAssetMetadata : undefined,
    importImageFromPath,
    saveTransparentPng,
    openSettingsWindow,
    createMascotWindow,
    applyConfigToMascot,
    ensureMascotWindowOnScreen,
    selectDisplayForMascot: typeof selectDisplayForMascot === 'function' ? selectDisplayForMascot : undefined,
    recallMascotToCenter: typeof recallMascotToCenter === 'function' ? recallMascotToCenter : undefined,
    synchronizeMascotPassthrough: typeof synchronizeMascotPassthrough === 'function' ? synchronizeMascotPassthrough : undefined,
    setMascotWindow(value) { mascotWindow = value; },
    setSettingsWindow(value) { settingsWindow = value; },
    toggleVisibility,
    getSettingsDirty() { return typeof settingsDirty === 'undefined' ? undefined : settingsDirty; },
    getPaused() { return paused; },
    setPaused,
    runMascotWatchdog,
    startMascotRecoveryMonitoring,
    scheduleEnvironmentRecovery,
    recordDiagnostic,
    RECOVERY_TIMING,
    createTray,
    rebuildTrayMenu,
    isMascotHiddenByUser() { return mascotHiddenByUser; },
  };`;

  const api = runScript(source, context, 'main.js');
  return {
    api,
    handlers,
    ipcListeners,
    app,
    electron,
    context,
    browserWindows,
    errorBoxes,
    shownItems,
    menus,
    trayInstances,
  };
}

export function loadPreloadForTest({ projectRoot, fileName = 'preload.js' } = {}) {
  const invoked = [];
  const sent = [];
  const listeners = new Map();
  let exposedName = null;
  let exposedApi = null;
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, api) {
        exposedName = name;
        exposedApi = api;
      },
    },
    ipcRenderer: {
      invoke(channel, ...args) {
        invoked.push({ channel, args });
        return Promise.resolve(null);
      },
      send(channel, ...args) { sent.push({ channel, args }); },
      on(channel, listener) { listeners.set(channel, listener); },
      removeListener(channel, listener) {
        if (listeners.get(channel) === listener) listeners.delete(channel);
      },
    },
    webUtils: { getPathForFile: () => '/tmp/example.png' },
  };
  const context = {
    console,
    require(id) {
      if (id === 'electron') return electron;
      return hostRequire(id);
    },
  };
  context.globalThis = context;
  const source = fs.readFileSync(path.join(projectRoot, fileName), 'utf8');
  vm.runInNewContext(source, context, { filename: fileName });
  return {
    exposedName,
    api: exposedApi,
    invoked,
    sent,
    listeners,
    context,
  };
}

export function loadRendererForTest({
  projectRoot,
  width = 800,
  height = 600,
  random = Math.random,
  localStorage: localStorageOverride,
  mascotAPI: mascotAPIOverride = {},
  ImageClass = class {},
} = {}) {
  const { document, nodes } = createDomStub();
  const projectRequire = createRequire(path.join(projectRoot, 'main.js'));
  const passthroughCalls = [];
  const storage = localStorageOverride || { getItem: () => null, setItem() {} };
  const windowObject = createWindowEventTarget({
    innerWidth: width,
    innerHeight: height,
    requestAnimationFrame() {},
    setTimeout,
    clearTimeout,
    mascotAPI: {
      setMousePassthrough(value) { passthroughCalls.push(value); },
      onCommand() {},
      reportDiagnostic() {},
      loadConfig: async () => ({ config: { mascot: {}, actions: [] } }),
      resolveAsset: async () => null,
      reportApplyResult() {},
      ...mascotAPIOverride,
    },
    DesktopMascotConfigRules: projectRequire('./shared/config-rules'),
    DesktopMascotConcurrency: projectRequire('./shared/concurrency'),
  });
  const vmMath = Object.create(Math);
  vmMath.random = random;
  const context = {
    console,
    document,
    window: windowObject,
    localStorage: storage,
    performance: { now: () => 0 },
    requestAnimationFrame() {},
    setTimeout,
    clearTimeout,
    Image: ImageClass,
    Math: vmMath,
  };

  let source = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');
  const bootPattern = /\nreloadConfig\(\{ keepPosition: false \}\)\.then\(\(\) => \{[\s\S]*?\n\}\);\s*$/;
  if (!bootPattern.test(source)) throw new Error('renderer.js の自動起動箇所を特定できません。');
  source = source.replace(bootPattern, '\n');
  source += `\n;globalThis.__phase0 = {
    state,
    chooseWeightedAction,
    getMascotWidth,
    getMascotHeight,
    axisMovementBounds,
    movementBounds,
    clampPosition,
    ensureMascotVisible,
    renderPosition: typeof renderPosition === 'function' ? renderPosition : undefined,
    configuredStartPosition,
    setMousePassthrough,
    applyFlip,
    pointIsInsideMascot,
    savePosition,
    setPosition,
    setAction,
    displayAction: typeof displayAction === 'function' ? displayAction : undefined,
    mapWithConcurrency: typeof mapWithConcurrency === 'function' ? mapWithConcurrency : undefined,
    createEffect: typeof createEffect === 'function' ? createEffect : undefined,
    clearEffects: typeof clearEffects === 'function' ? clearEffects : undefined,
    reloadConfig,
    updateMotion,
    failedActionIds,
  };`;

  const api = runScript(source, context, 'renderer.js');
  const mascotNode = nodes.get('mascot');
  mascotNode.getBoundingClientRect = () => {
    const mascotWidth = api.getMascotWidth();
    const mascotHeight = api.getMascotHeight();
    const { x, y } = api.state.position;
    return { left: x, top: y, width: mascotWidth, height: mascotHeight, right: x + mascotWidth, bottom: y + mascotHeight };
  };
  return { api, nodes, window: windowObject, passthroughCalls, localStorage: storage, context };
}

export function loadSettingsForTest({
  projectRoot,
  mascotAPI: mascotAPIOverride = {},
  ImageClass = class {},
  provideMascotAPI = true,
  provideConfigRules = true,
  provideConcurrency = true,
  runBoot = false,
  now = () => Date.now(),
} = {}) {
  const { document, nodes } = createDomStub();
  const defaultConfig = {
    name: 'Phase 0',
    mascot: { size: 180, startPosition: 'bottom-right', margin: 40, rememberPosition: true },
    actions: [{
      name: '休む',
      file: 'actions/rest.svg',
      weight: 1,
      durationMs: [6000, 10000],
      movement: { type: 'still', speed: 0 },
    }],
  };
  const mascotAPI = {
    loadConfig: async () => ({ config: structuredClone(defaultConfig) }),
    resolveAsset: async (relativePath) => `file://${relativePath}`,
    chooseImage: async () => null,
    importImage: async () => null,
    saveTransparentPng: async () => null,
    getPathForFile: () => '',
    getAppInfo: async () => ({ isPackaged: false }),
    prepareDistributionDefaults: async () => ({ ok: true }),
    saveConfig: async (config) => ({ ok: true, applied: true, config }),
    recoverConfig: async () => ({ ok: true }),
    reportDirtyState() {},
    getAssetMetadata: async () => null,
    ...mascotAPIOverride,
  };
  const windowBase = {
    location: { href: 'file:///settings.html' },
    clearTimeout,
    setTimeout,
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    confirm: () => true,
  };
  if (provideMascotAPI) windowBase.mascotAPI = mascotAPI;
  const windowObject = createWindowEventTarget(windowBase);
  if (provideConfigRules || provideConcurrency) {
    const projectRequire = createRequire(path.join(projectRoot, 'main.js'));
    if (provideConfigRules) {
      windowObject.DesktopMascotConfigRules = projectRequire('./shared/config-rules');
    }
    if (provideConcurrency) {
      windowObject.DesktopMascotConcurrency = projectRequire('./shared/concurrency');
    }
  }
  const context = {
    console,
    document,
    window: windowObject,
    URL,
    Blob,
    structuredClone,
    crypto: { randomUUID },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: windowObject.requestAnimationFrame,
    cancelAnimationFrame: clearTimeout,
    Image: ImageClass,
    ImageData: class {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    },
    Uint8ClampedArray,
    Math,
    Date: class TestDate extends Date { static now() { return now(); } },
  };

  let source = fs.readFileSync(path.join(projectRoot, 'settings.js'), 'utf8');
  const bootPattern = /\n(?:loadConfiguration|initializeSettings)\(\);\s*$/;
  if (!bootPattern.test(source)) throw new Error('settings.js の自動起動箇所を特定できません。');
  if (!runBoot) source = source.replace(bootPattern, '\n');
  source += `\n;globalThis.__phase0 = {
    state,
    elements,
    loadConfiguration,
    setBusy,
    markDirty,
    markSaved,
    markLoaded: typeof markLoaded === 'function' ? markLoaded : undefined,
    serializeConfig,
    saveConfiguration,
    prepareDistributionDefaults,
    beginOperation: typeof beginOperation === 'function' ? beginOperation : undefined,
    endOperation: typeof endOperation === 'function' ? endOperation : undefined,
    addAction: typeof addAction === 'function' ? addAction : undefined,
    renderActionList: typeof renderActionList === 'function' ? renderActionList : undefined,
    renderEditor: typeof renderEditor === 'function' ? renderEditor : undefined,
    openImageEditor: typeof openImageEditor === 'function' ? openImageEditor : undefined,
    fitActionIntoFrame: typeof fitActionIntoFrame === 'function' ? fitActionIntoFrame : undefined,
    computeClipping: typeof computeClipping === 'function' ? computeClipping : undefined,
    measurementForTransform: typeof measurementForTransform === 'function'
      ? measurementForTransform
      : undefined,
    fitTransformToFrame: typeof fitTransformToFrame === 'function' ? fitTransformToFrame : undefined,
    getActionMeasurement: typeof getActionMeasurement === 'function' ? getActionMeasurement : undefined,
    requestVisibleContentMeasurements: typeof requestVisibleContentMeasurements === 'function' ? requestVisibleContentMeasurements : undefined,
    actionMeasurements: typeof actionMeasurements === 'undefined' ? undefined : actionMeasurements,
    updateActionName: typeof updateActionName === 'function' ? updateActionName : undefined,
    mapWithConcurrency: typeof mapWithConcurrency === 'function' ? mapWithConcurrency : undefined,
    measureVisibleContent,
    sizeMeasurementCache,
    beginSizeManagerGeneration: typeof beginSizeManagerGeneration === 'function' ? beginSizeManagerGeneration : undefined,
    isSizeManagerGenerationCurrent: typeof isSizeManagerGenerationCurrent === 'function' ? isSizeManagerGenerationCurrent : undefined,
    beginJpegGeneration: typeof beginJpegGeneration === 'function' ? beginJpegGeneration : undefined,
    isJpegGenerationCurrent: typeof isJpegGenerationCurrent === 'function' ? isJpegGenerationCurrent : undefined,
    invalidateJpegGeneration: typeof invalidateJpegGeneration === 'function' ? invalidateJpegGeneration : undefined,
  };`;

  const api = runScript(source, context, 'settings.js');
  return { api, nodes, window: windowObject, mascotAPI, context };
}

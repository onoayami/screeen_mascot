const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  powerMonitor,
  screen,
  shell,
} = require('electron');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  installDefaultsFromSource,
  recoverDirectoryTransaction,
  replaceDirectoryTransaction,
  replaceFileAtomically,
} = require('./shared/distribution-defaults');
const {
  copyValidatedImageFile,
  isLexicallyInsideRoot,
  MAX_IMAGE_FILE_BYTES,
  normalizeRelativeImagePath,
  resolveImageFileWithinRoot,
  sha256Buffer,
  sha256File,
  validateStandaloneImageFile,
} = require('./shared/asset-validation');
const { createImageDecodeValidator } = require('./shared/image-decode');
const {
  validateAndNormalizeConfig: validateConfigWithRules,
  validateAndNormalizeLoadedConfig: validateLoadedConfigWithRules,
} = require('./shared/config-rules');

let mascotWindow = null;
let settingsWindow = null;
let tray = null;
let paused = false;
let applyRequestCounter = 0;
let settingsDirty = false;
let allowSettingsClose = false;
let settingsClosePromptPending = false;
let quitRequested = false;
let quitAttemptCounter = 0;
let activeQuitAttemptSequence = null;
let pointerSyncTimer = null;
let mascotWatchdogTimer = null;
let mascotRecoveryTimer = null;
let unresponsiveTimer = null;
let rendererReloadTimer = null;
let mascotHiddenByUser = false;
let recoveryMonitoringStarted = false;
let rendererFailureCount = 0;
let rendererReloadStopped = false;
let rendererIsUnresponsive = false;
let pendingRendererReadyNotification = null;
let lastPointerSync = null;
const POINTER_SYNC_HEARTBEAT_MS = 5000;
const sessionImportedImagePaths = new Set();
const droppedPathTokens = new Map();
const DROPPED_PATH_TOKEN_TTL_MS = 60_000;
const MAX_DROPPED_PATH_TOKENS = 50;
const diagnosticBuffer = [];
let diagnosticFlushTimer = null;
let diagnosticWriteInProgress = false;
let diagnosticWritePromise = Promise.resolve();
let diagnosticQuitFlushPending = false;
let lastRendererReloadAt = -Infinity;
let rendererReloadReason = '';
let preparedCharacterDirectory = null;
const pendingApplyRequests = new Map();
const RECOVERY_TIMING = {
  watchdogIntervalMs: 2000,
  recoveryDelayMs: 2000,
  unresponsiveTimeoutMs: 5000,
  rendererReloadCooldownMs: 10000,
  watchdogRepairLimit: 5,
  watchdogRepairWindowMs: 60000,
  watchdogRepairCooldownMs: 60000,
};
const MAX_CONSECUTIVE_RENDERER_FAILURES = 3;
const DIAGNOSTIC_LOG_MAX_BYTES = 1024 * 1024;
const watchdogRepairHistory = new Map();
const RENDERER_DIAGNOSTIC_TYPES = new Set([
  'window-error',
  'unhandled-rejection',
  'image-load-failed',
]);

app.on('before-quit', (event) => {
  quitRequested = true;
  if (activeQuitAttemptSequence === null) beginQuitAttempt('native');
  recordQuitDiagnostic('before-quit');
  if (
    settingsDirty
    && !allowSettingsClose
    && settingsWindow
    && !settingsWindow.isDestroyed()
  ) {
    event.preventDefault();
    confirmSettingsClose(settingsWindow);
    return;
  }
  if (diagnosticWriteInProgress) {
    event.preventDefault();
    if (!diagnosticQuitFlushPending) {
      diagnosticQuitFlushPending = true;
      void flushDiagnostics().finally(() => {
        flushDiagnosticsSync();
        diagnosticQuitFlushPending = false;
        if (quitRequested && activeQuitAttemptSequence !== null) app.quit();
      });
    }
  } else flushDiagnosticsSync();
});
app.on('will-quit', () => {
  recordQuitDiagnostic('will-quit');
  recordQuitDiagnostic('app-quit');
  flushDiagnosticsSync();
  activeQuitAttemptSequence = null;
  quitRequested = false;
});

const LEGACY_CAT_PAW_SHA256 = 'b09160f6eb8006787e487390c3b12a6711aa96c6120402d22b92bf53a7de0a92';
const LEGACY_DEFAULT_ASSET_SHA256 = Object.freeze({
  'actions/fly.svg': '0a1bc3b21aeccee20590074c0a997ce3273b3324019eddfa296006dbb6f19ef5',
  'actions/rest.svg': '246ada2ec539f1e66d2109c5adfdf5d01ad052363128ba3d43d74f2085037fd0',
  'actions/sing.svg': '6a68748dfbc17455e674906135c177481a103098fb01e2d95459319e6e661e87',
  'actions/walk.svg': 'c9cf93aef76242f5311db3ba1176b3ab7866c6e7faeb23fbb151d952a5fb3741',
  'effects/footprint.svg': LEGACY_CAT_PAW_SHA256,
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
const validateImageDecodes = createImageDecodeValidator({ nativeImage, fsModule: fs });

function getCharacterDirectory() {
  return path.join(app.getPath('userData'), 'characters');
}

function diagnosticBounds(bounds) {
  return {
    x: Number.isFinite(bounds?.x) ? Math.round(bounds.x) : null,
    y: Number.isFinite(bounds?.y) ? Math.round(bounds.y) : null,
    width: Number.isFinite(bounds?.width) ? Math.round(bounds.width) : null,
    height: Number.isFinite(bounds?.height) ? Math.round(bounds.height) : null,
  };
}

function getDisplayDiagnostics() {
  const displays = screen.getAllDisplays();
  return {
    displayCount: displays.length,
    resolutions: displays.map((display) => ({
      width: Math.round(display.bounds.width),
      height: Math.round(display.bounds.height),
    })),
  };
}

function recordDiagnostic(event, details = {}) {
  const line = `${JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...details,
  })}\n`;
  diagnosticBuffer.push(line);
  if (diagnosticBuffer.length >= 20) {
    void flushDiagnostics();
  } else if (!diagnosticFlushTimer) {
    diagnosticFlushTimer = setTimeout(() => {
      diagnosticFlushTimer = null;
      startDiagnosticWrite();
    }, 250);
    diagnosticFlushTimer.unref?.();
  }
}

function diagnosticLogPaths() {
  const directory = app.getPath('userData');
  return {
    filePath: path.join(directory, 'mascot-diagnostics.log'),
    oldFilePath: path.join(directory, 'mascot-diagnostics.old.log'),
  };
}

function rotateDiagnosticLogSync(filePath, oldFilePath, appendedBytes) {
  let currentSize = 0;
  try {
    currentSize = fs.statSync(filePath).size;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (currentSize + appendedBytes <= DIAGNOSTIC_LOG_MAX_BYTES) return;
  if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
  if (currentSize > 0) fs.renameSync(filePath, oldFilePath);
}

function writeDiagnosticBatchSync(lines) {
  if (lines.length === 0) return true;
  const { filePath, oldFilePath } = diagnosticLogPaths();
  const content = lines.join('');
  try {
    rotateDiagnosticLogSync(filePath, oldFilePath, Buffer.byteLength(content, 'utf8'));
    fs.appendFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch (error) {
    console.warn('診断ログを書き込めませんでした。', String(error?.message || error));
    return false;
  }
}

async function writeDiagnosticBatch(lines) {
  if (lines.length === 0) return;
  const { filePath, oldFilePath } = diagnosticLogPaths();
  const content = lines.join('');
  let handle = null;
  let originalSize = 0;
  let originalSizeKnown = false;
  try {
    let currentSize = 0;
    try {
      currentSize = (await fs.promises.stat(filePath)).size;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (currentSize + Buffer.byteLength(content, 'utf8') > DIAGNOSTIC_LOG_MAX_BYTES) {
      try {
        await fs.promises.unlink(oldFilePath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (currentSize > 0) await fs.promises.rename(filePath, oldFilePath);
    }
    handle = await fs.promises.open(filePath, 'a+', 0o600);
    originalSize = (await handle.stat()).size;
    originalSizeKnown = true;
    const bytes = Buffer.from(content, 'utf8');
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, originalSize + offset);
      if (bytesWritten <= 0) throw new Error('診断ログを書き込めませんでした。');
      offset += bytesWritten;
    }
    return true;
  } catch (error) {
    if (handle && originalSizeKnown) {
      try {
        await handle.truncate(originalSize);
      } catch (_truncateError) {
        console.warn('診断ログの不完全な書き込みを整理できませんでした。');
      }
    }
    console.warn('診断ログを書き込めませんでした。', String(error?.message || error));
    return false;
  } finally {
    await handle?.close().catch((error) => {
      console.warn('診断ログを閉じられませんでした。', String(error?.message || error));
    });
  }
}

function startDiagnosticWrite() {
  if (diagnosticWriteInProgress || diagnosticBuffer.length === 0) return diagnosticWritePromise;
  const lines = diagnosticBuffer.splice(0, diagnosticBuffer.length);
  diagnosticWriteInProgress = true;
  let succeeded = false;
  diagnosticWritePromise = writeDiagnosticBatch(lines).then((result) => {
    succeeded = result;
    if (!result) diagnosticBuffer.unshift(...lines);
    return result;
  }).finally(() => {
    diagnosticWriteInProgress = false;
    if (succeeded && diagnosticBuffer.length > 0 && !diagnosticFlushTimer) {
      diagnosticFlushTimer = setTimeout(() => {
        diagnosticFlushTimer = null;
        startDiagnosticWrite();
      }, 250);
      diagnosticFlushTimer.unref?.();
    }
  });
  return diagnosticWritePromise;
}

async function flushDiagnostics() {
  if (diagnosticFlushTimer) {
    clearTimeout(diagnosticFlushTimer);
    diagnosticFlushTimer = null;
  }
  while (diagnosticBuffer.length > 0 || diagnosticWriteInProgress) {
    if (diagnosticWriteInProgress) await diagnosticWritePromise;
    else if (!await startDiagnosticWrite()) return false;
  }
  return true;
}

function flushDiagnosticsSync() {
  if (diagnosticWriteInProgress) return false;
  if (diagnosticFlushTimer) {
    clearTimeout(diagnosticFlushTimer);
    diagnosticFlushTimer = null;
  }
  const lines = diagnosticBuffer.splice(0, diagnosticBuffer.length);
  if (writeDiagnosticBatchSync(lines)) return true;
  diagnosticBuffer.unshift(...lines);
  return false;
}

function recordQuitDiagnostic(event, details = {}) {
  recordDiagnostic(event, {
    processId: process.pid,
    quitAttemptSequence: activeQuitAttemptSequence,
    ...details,
  });
  flushDiagnosticsSync();
}

function beginQuitAttempt(source) {
  if (activeQuitAttemptSequence === null) {
    quitAttemptCounter += 1;
    activeQuitAttemptSequence = quitAttemptCounter;
  }
  recordQuitDiagnostic('quit-requested', { source });
  return activeQuitAttemptSequence;
}

function requestAppQuit(source) {
  beginQuitAttempt(source);
  app.quit();
}

function clearQuitAttempt() {
  activeQuitAttemptSequence = null;
  quitRequested = false;
}

function confirmSettingsClose(promptWindow) {
  if (settingsClosePromptPending || !promptWindow || promptWindow.isDestroyed()) return;
  if (quitRequested) {
    if (promptWindow.isMinimized?.()) promptWindow.restore();
    if (!promptWindow.isVisible()) promptWindow.show();
    promptWindow.focus();
  }
  settingsClosePromptPending = true;
  recordQuitDiagnostic('quit-confirmation-pending');
  Promise.resolve().then(() => dialog.showMessageBox(promptWindow, {
    type: 'warning',
    title: '未保存の変更があります',
    message: '設定を保存せずに閉じますか？',
    detail: '「編集に戻る」を選ぶと、この画面を開いたままにします。',
    buttons: ['編集に戻る', '保存せず閉じる'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })).then(({ response }) => {
    if (settingsWindow !== promptWindow || promptWindow.isDestroyed()) {
      const clearAttempt = settingsWindow === null || settingsWindow === promptWindow;
      recordQuitDiagnostic('quit-confirmation-window-unavailable', {
        quitAttemptSequence: clearAttempt ? activeQuitAttemptSequence : null,
        decision: response === 1 ? 'discard' : 'edit',
      });
      if (clearAttempt) clearQuitAttempt();
      return;
    }
    settingsClosePromptPending = false;
    if (response !== 1) {
      recordQuitDiagnostic('quit-confirmation-cancelled', { decision: 'edit' });
      clearQuitAttempt();
      return;
    }
    recordQuitDiagnostic('quit-confirmation-discarded', { decision: 'discard' });
    allowSettingsClose = true;
    settingsDirty = false;
    promptWindow.close();
    if (quitRequested) requestAppQuit('discard-confirmed');
  }).catch((error) => {
    if (settingsWindow === promptWindow) {
      settingsClosePromptPending = false;
      recordQuitDiagnostic('quit-confirmation-error');
      clearQuitAttempt();
    } else if (settingsWindow === null) {
      recordQuitDiagnostic('quit-confirmation-error');
      clearQuitAttempt();
    } else {
      recordQuitDiagnostic('quit-confirmation-error', {
        quitAttemptSequence: null,
      });
    }
    dialog.showErrorBox('設定画面を閉じられませんでした', String(error?.message || error));
  });
}

function mascotWindowSnapshot() {
  if (!mascotWindow || mascotWindow.isDestroyed()) return { exists: false };
  return {
    exists: true,
    bounds: diagnosticBounds(mascotWindow.getBounds()),
    visible: mascotWindow.isVisible(),
    alwaysOnTop: typeof mascotWindow.isAlwaysOnTop === 'function'
      ? mascotWindow.isAlwaysOnTop()
      : null,
  };
}

function getBundledCharacterDirectory() {
  return path.join(__dirname, 'characters', 'default');
}

function getCharacterAssetMetadata(relativePath) {
  const assetPath = resolveImageFileWithinRoot(getCharacterDirectory(), relativePath, {
    fsModule: fs,
  });
  const stat = fs.statSync(assetPath);
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    cacheKey: `${stat.size}:${Math.trunc(stat.mtimeMs)}`,
  };
}

function assertCharacterDirectoryRoot(directory) {
  if (!fs.existsSync(directory)) return;
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) {
    throw new Error('素材フォルダがシンボリックリンクです。安全のため起動を停止しました。');
  }
  if (!stat.isDirectory()) {
    throw new Error('素材フォルダが通常のフォルダではありません。安全のため起動を停止しました。');
  }
}

function migrateLegacyDefaultAsset(source, destination, relativePath, legacySha256) {
  const bundledCandidate = path.join(source, relativePath);
  const installedCandidate = path.join(destination, relativePath);
  if (!fs.existsSync(bundledCandidate) || !fs.existsSync(installedCandidate)) return false;
  const bundledAsset = resolveImageFileWithinRoot(source, relativePath, {
    fsModule: fs,
    validateAsset: validateImageDecodes,
  });
  const installedAsset = resolveImageFileWithinRoot(destination, relativePath, {
    fsModule: fs,
    validateAsset: validateImageDecodes,
  });
  if (sha256File(installedAsset) !== legacySha256) return false;

  replaceFileAtomically({
    sourceFile: bundledAsset,
    destinationFile: installedAsset,
    relativePath,
    fsModule: fs,
    validateAsset: validateImageDecodes,
  });
  return true;
}

function migrateLegacyDefaultAssets(source, destination) {
  let migratedCount = 0;
  for (const [relativePath, legacySha256] of Object.entries(LEGACY_DEFAULT_ASSET_SHA256)) {
    if (migrateLegacyDefaultAsset(source, destination, relativePath, legacySha256)) {
      migratedCount += 1;
    }
  }
  return migratedCount;
}

function recoverDevelopmentDistributionDefaults() {
  if (app.isPackaged) return { skipped: true };
  return recoverDirectoryTransaction({
    destinationRoot: getBundledCharacterDirectory(),
    fsModule: fs,
  });
}

function ensureCharacterDirectory() {
  const destination = getCharacterDirectory();
  if (preparedCharacterDirectory === destination) {
    assertCharacterDirectoryRoot(destination);
    if (fs.existsSync(destination)) return destination;
  }

  if (!app.isPackaged) recoverDevelopmentDistributionDefaults();
  const source = getBundledCharacterDirectory();

  recoverDirectoryTransaction({ destinationRoot: destination, fsModule: fs });
  assertCharacterDirectoryRoot(destination);

  if (!fs.existsSync(destination)) {
    installDefaultsFromSource({
      sourceRoot: source,
      destinationRoot: destination,
      fsModule: fs,
      validateAsset: validateImageDecodes,
    });
  }

  assertCharacterDirectoryRoot(destination);
  migrateLegacyDefaultAssets(source, destination);
  removeStaleConfigTemporaryFiles(destination);

  preparedCharacterDirectory = destination;
  return destination;
}

function removeStaleConfigTemporaryFiles(directory) {
  const temporaryNamePattern = /^config(?:\.backup)?\.json\.\d+\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.tmp$/i;
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    console.warn('設定の一時ファイルを確認できませんでした。', error);
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !temporaryNamePattern.test(entry.name)) continue;
    try {
      fs.unlinkSync(path.join(directory, entry.name));
    } catch (error) {
      console.warn(`設定の一時ファイルを削除できませんでした：${entry.name}`, error);
    }
  }
}

function requireCharacterPath(relativePath) {
  return resolveImageFileWithinRoot(getCharacterDirectory(), relativePath, {
    fsModule: fs,
    validateAsset: validateImageDecodes,
  });
}

function resolveCharacterPath(relativePath) {
  try {
    return requireCharacterPath(relativePath);
  } catch (_error) {
    return null;
  }
}

function resolveCharacterAsset(relativePath) {
  const filePath = resolveCharacterPath(relativePath);
  return filePath ? pathToFileURL(filePath).href : null;
}

const validateAndNormalizeConfig = (input) => validateConfigWithRules(input, {
  validateAsset: requireCharacterPath,
});
const validateAndNormalizeLoadedConfig = (input) => validateLoadedConfigWithRules(input, {
  validateAsset: requireCharacterPath,
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
}

function hashNormalizedConfig(config) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(config))).digest('hex');
}

function configBackupPath(directory = getCharacterDirectory()) {
  return path.join(directory, 'config.backup.json');
}

function writeJsonAtomic(destination, value) {
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx');
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
  } catch (error) {
    try {
      fs.closeSync(descriptor);
    } catch (closeError) {
      try {
        fs.rmSync(temporary, { force: true });
      } catch (cleanupError) {
        throw new AggregateError([error, closeError, cleanupError], '設定の一時ファイルを整理できませんでした。');
      }
      throw new AggregateError([error, closeError], '設定の書き込みまたはクローズに失敗しました。');
    }
    try {
      fs.rmSync(temporary, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], '設定の一時ファイルを整理できませんでした。');
    }
    throw error;
  }

  try {
    fs.renameSync(temporary, destination);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], '設定の一時ファイルを整理できませんでした。');
    }
    throw error;
  }
}

function writeConfigBackup(config, directory = getCharacterDirectory()) {
  writeJsonAtomic(configBackupPath(directory), config);
}

function collectConfigAssetReferences(config) {
  const references = [];
  for (const action of config?.actions || []) {
    if (action.file) references.push(action.file);
    if (action.effect?.file) references.push(action.effect.file);
  }
  return [...new Set(references)];
}

function discardImportedImage(relativePath, category) {
  if (!['actions', 'effects'].includes(category)) throw new Error('画像カテゴリが正しくありません。');
  const normalized = normalizeRelativeImagePath(relativePath);
  if (!/\.jpe?g$/i.test(normalized)) return false;
  if (!normalized.startsWith(`${category}/`)) throw new Error('画像の保存先が正しくありません。');
  const characterRoot = getCharacterDirectory();
  const imagePath = resolveImageFileWithinRoot(characterRoot, normalized, { fsModule: fs });
  if (!isLexicallyInsideRoot(path.join(characterRoot, category), imagePath)) {
    throw new Error('画像の保存先が正しくありません。');
  }
  const absolutePath = path.resolve(imagePath);
  if (!sessionImportedImagePaths.has(absolutePath)) return false;
  const editable = loadEditableConfig();
  if (!editable?.config) return false;
  if (collectConfigAssetReferences(editable.config).includes(normalized)) return false;
  fs.unlinkSync(absolutePath);
  sessionImportedImagePaths.delete(absolutePath);
  return true;
}

function writeConfigAtomic(config, { backupCurrent = true } = {}) {
  const directory = ensureCharacterDirectory();
  const destination = path.join(directory, 'config.json');
  if (backupCurrent && fs.existsSync(destination)) {
    try {
      const current = JSON.parse(fs.readFileSync(destination, 'utf8'));
      validateLoadedConfigWithRules(current);
      writeConfigBackup(current, directory);
    } catch (error) {
      // Keep the last known-good backup when the current file is broken.
      recordDiagnostic('config-backup-skipped', {
        reason: String(error?.message || error),
      });
    }
  }
  writeJsonAtomic(destination, config);
  return destination;
}

function loadNormalizedConfig({ persistMigration = true } = {}) {
  const characterDirectory = ensureCharacterDirectory();
  const configPath = path.join(characterDirectory, 'config.json');
  const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const { config, warnings } = validateAndNormalizeLoadedConfig(rawConfig);
  const configHash = hashNormalizedConfig(config);
  const hasLegacyMovementSpeeds = warnings.length > 0;

  if (
    !hasLegacyMovementSpeeds
    && persistMigration
    && hashNormalizedConfig(rawConfig) !== configHash
  ) {
    writeConfigAtomic(config);
  } else if (!hasLegacyMovementSpeeds && !fs.existsSync(configBackupPath(characterDirectory))) {
    writeConfigBackup(config, characterDirectory);
  }

  return { config, characterDirectory, configHash, warnings };
}

function loadMascotRuntimeConfig() {
  try {
    return loadNormalizedConfig();
  } catch (error) {
    if (!error?.assetUnavailable && !error?.assetContentInvalid) throw error;
    const characterDirectory = getCharacterDirectory();
    const rawConfig = JSON.parse(fs.readFileSync(path.join(characterDirectory, 'config.json'), 'utf8'));
    const { config, warnings } = validateLoadedConfigWithRules(rawConfig);
    return {
      config,
      characterDirectory,
      configHash: hashNormalizedConfig(config),
      warnings,
      assetsIncomplete: true,
    };
  }
}

function editableRecovery(kind, error, characterDirectory) {
  return {
    kind,
    message: String(error?.message || error || ''),
    canRestoreBackup: fs.existsSync(configBackupPath(characterDirectory)),
    canInitialize: true,
  };
}

function loadEditableConfig() {
  const characterDirectory = ensureCharacterDirectory();
  const configPath = path.join(characterDirectory, 'config.json');
  let rawConfig;
  try {
    rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    return {
      config: null,
      characterDirectory,
      warnings: ['config.json が壊れているため、自動では上書きしません。'],
      missingAssets: [],
      recovery: editableRecovery('invalid-json', error, characterDirectory),
    };
  }

  let config;
  let compatibilityWarnings = [];
  try {
    const loaded = validateLoadedConfigWithRules(rawConfig);
    config = loaded.config;
    compatibilityWarnings = loaded.warnings;
  } catch (error) {
    return {
      config: null,
      characterDirectory,
      warnings: [`設定値を読み込めません：${String(error?.message || error)}`],
      missingAssets: [],
      recovery: editableRecovery('invalid-config', error, characterDirectory),
    };
  }

  const missingAssets = collectConfigAssetReferences(config)
    .filter((relativePath) => !resolveCharacterPath(relativePath));
  const warnings = [
    ...(compatibilityWarnings || []),
    ...missingAssets.map((relativePath) => `画像が見つかりません：${relativePath}`),
  ];
  return {
    config,
    characterDirectory,
    configHash: hashNormalizedConfig(config),
    warnings,
    pendingMigrations: compatibilityWarnings.length > 0 ? ['legacy-movement-speed'] : [],
    missingAssets,
    recovery: {
      kind: missingAssets.length > 0 ? 'missing-assets' : 'none',
      canRestoreBackup: fs.existsSync(configBackupPath(characterDirectory)),
      canInitialize: true,
    },
  };
}

function pruneRecoveryFiles(directory, keep = 5) {
  const files = fs.readdirSync(directory)
    .filter((name) => /^config\.recovery-\d+(?:-[0-9a-f]{8})?\.json$/i.test(name))
    .sort((left, right) => {
      const leftTimestamp = Number(left.match(/^config\.recovery-(\d+)/)[1]);
      const rightTimestamp = Number(right.match(/^config\.recovery-(\d+)/)[1]);
      return leftTimestamp - rightTimestamp;
    });
  for (const name of files.slice(0, Math.max(0, files.length - keep))) {
    fs.rmSync(path.join(directory, name), { force: true });
  }
}

function preserveCurrentConfig(characterDirectory) {
  const source = path.join(characterDirectory, 'config.json');
  if (!fs.existsSync(source)) return null;
  const destination = path.join(
    characterDirectory,
    `config.recovery-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`,
  );
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  pruneRecoveryFiles(characterDirectory);
  return destination;
}

function restoreBundledAsset(relativePath, characterDirectory) {
  if (resolveCharacterPath(relativePath)) return;
  const source = resolveImageFileWithinRoot(getBundledCharacterDirectory(), relativePath, {
    fsModule: fs,
    validateAsset: validateImageDecodes,
  });
  const destination = path.join(characterDirectory, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = temporaryImagePath(destination, 'restore');
  try {
    copyValidatedImageFile({
      sourceFile: source,
      destinationFile: temporary,
      fsModule: fs,
      validateAsset: validateImageDecodes,
    });
    fs.rmSync(destination, { force: true });
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function recoverEditableConfig(strategy) {
  const characterDirectory = ensureCharacterDirectory();
  let config;
  let compatibilityWarnings = [];
  if (strategy === 'backup') {
    const backup = configBackupPath(characterDirectory);
    if (!fs.existsSync(backup)) throw new Error('復元できるバックアップがありません。');
    const loaded = validateAndNormalizeLoadedConfig(JSON.parse(fs.readFileSync(backup, 'utf8')));
    config = loaded.config;
    compatibilityWarnings = loaded.warnings;
  } else if (strategy === 'defaults') {
    const bundledPath = path.join(getBundledCharacterDirectory(), 'config.json');
    config = validateConfigWithRules(JSON.parse(fs.readFileSync(bundledPath, 'utf8')));
    for (const relativePath of collectConfigAssetReferences(config)) {
      restoreBundledAsset(relativePath, characterDirectory);
    }
    config = validateAndNormalizeConfig(config);
  } else {
    throw new Error('復旧方法が正しくありません。');
  }

  const recoveryPath = preserveCurrentConfig(characterDirectory);
  writeConfigAtomic(config, { backupCurrent: false });
  writeConfigBackup(config, characterDirectory);
  const editable = loadEditableConfig();
  return {
    ok: true,
    recoveryPath,
    ...editable,
    warnings: [...compatibilityWarnings, ...editable.warnings],
  };
}

function uniqueDestination(directory, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(directory, fileName);
  let counter = 2;

  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${parsed.name}-${counter}${parsed.ext}`);
    counter += 1;
  }

  return candidate;
}

function publishImageTemporary(temporary, directory, fileName) {
  const parsed = path.parse(fileName);
  let counter = 1;
  while (true) {
    const candidateName = counter === 1
      ? fileName
      : `${parsed.name}-${counter}${parsed.ext}`;
    const candidate = path.join(directory, candidateName);
    try {
      fs.linkSync(temporary, candidate);
    } catch (error) {
      if (error.code === 'EEXIST') {
        counter += 1;
        continue;
      }
      if (!['EPERM', 'EXDEV', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
      try {
        fs.copyFileSync(temporary, candidate, fs.constants.COPYFILE_EXCL);
      } catch (copyError) {
        if (copyError.code === 'EEXIST') {
          counter += 1;
          continue;
        }
        throw copyError;
      }
    }
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      console.warn('画像の一時ファイルを削除できませんでした。', String(error?.message || error));
    }
    return candidate;
  }
}

function registerDroppedPath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') return null;
  const now = Date.now();
  for (const [token, entry] of droppedPathTokens) {
    if (entry.expiresAt <= now) droppedPathTokens.delete(token);
  }
  while (droppedPathTokens.size >= MAX_DROPPED_PATH_TOKENS) {
    droppedPathTokens.delete(droppedPathTokens.keys().next().value);
  }
  const token = `drop:${crypto.randomUUID()}`;
  droppedPathTokens.set(token, {
    filePath: path.resolve(filePath),
    expiresAt: now + DROPPED_PATH_TOKEN_TTL_MS,
  });
  return token;
}

function consumeDroppedPath(token) {
  const entry = droppedPathTokens.get(token);
  droppedPathTokens.delete(token);
  if (!entry || entry.expiresAt <= Date.now()) {
    throw new Error('画像の取り込み許可が無効または期限切れです。もう一度ドロップしてください。');
  }
  return entry.filePath;
}

function ensureAssetCategoryDirectory(category) {
  if (!['actions', 'effects'].includes(category)) throw new Error('保存先が正しくありません。');
  const characterRoot = ensureCharacterDirectory();
  const destinationDirectory = path.join(characterRoot, category);
  fs.mkdirSync(destinationDirectory, { recursive: true });
  const directoryStat = fs.lstatSync(destinationDirectory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error('画像の保存先が通常のフォルダではありません。');
  }
  const realCharacterRoot = fs.realpathSync(characterRoot);
  const realDestinationDirectory = fs.realpathSync(destinationDirectory);
  if (!isLexicallyInsideRoot(realCharacterRoot, realDestinationDirectory)) {
    throw new Error('画像の保存先が素材フォルダの外にあります。');
  }
  return { characterRoot, destinationDirectory };
}

function temporaryImagePath(destination, operation) {
  const parsed = path.parse(destination);
  return path.join(
    parsed.dir,
    `.${parsed.name}.${operation}-${crypto.randomUUID()}${parsed.ext}`,
  );
}

function importImageFromPath(sourcePath, category) {
  const sourceResolved = validateStandaloneImageFile(sourcePath, {
    fsModule: fs,
    label: path.basename(String(sourcePath || '画像')),
    validateAsset: validateImageDecodes,
  });
  const extension = path.extname(sourceResolved).toLowerCase();
  const { characterRoot, destinationDirectory } = ensureAssetCategoryDirectory(category);
  const safeBaseName = path.basename(sourceResolved).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    || `image${extension}`;
  const destinationRoot = path.resolve(destinationDirectory);

  let destination;
  let importedCopy = false;
  if (isLexicallyInsideRoot(destinationRoot, sourceResolved)) {
    const sourceRelativePath = path.relative(characterRoot, sourceResolved).split(path.sep).join('/');
    destination = resolveImageFileWithinRoot(characterRoot, sourceRelativePath, {
      fsModule: fs,
      validateAsset: validateImageDecodes,
    });
  } else {
    destination = uniqueDestination(destinationDirectory, safeBaseName);
    const temporary = temporaryImagePath(destination, 'import');
    try {
      copyValidatedImageFile({
        sourceFile: sourceResolved,
        destinationFile: temporary,
        fsModule: fs,
        validateAsset: validateImageDecodes,
      });
      destination = publishImageTemporary(temporary, destinationDirectory, safeBaseName);
      importedCopy = true;
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  }

  if (importedCopy) sessionImportedImagePaths.add(path.resolve(destination));
  const relativePath = path.relative(characterRoot, destination).split(path.sep).join('/');
  const isJpeg = extension === '.jpg' || extension === '.jpeg';
  return {
    relativePath,
    assetUrl: pathToFileURL(destination).href,
    isJpeg,
  };
}

function saveTransparentPng(arrayBuffer, category, originalName) {
  let pngBytes;
  if (arrayBuffer instanceof ArrayBuffer) {
    pngBytes = new Uint8Array(arrayBuffer);
  } else if (ArrayBuffer.isView(arrayBuffer)) {
    pngBytes = new Uint8Array(arrayBuffer.buffer, arrayBuffer.byteOffset, arrayBuffer.byteLength);
  } else {
    throw new Error('変換した画像データを受け取れませんでした。');
  }

  if (pngBytes.byteLength > MAX_IMAGE_FILE_BYTES) throw new Error('変換後の画像は20MB以下にしてください。');
  const pngBuffer = Buffer.from(pngBytes);
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const hasPngSignature = pngBuffer.length >= pngSignature.length
    && pngSignature.every((byte, index) => pngBuffer[index] === byte);

  if (!hasPngSignature) throw new Error('PNGへの変換に失敗しました。');

  const { characterRoot, destinationDirectory } = ensureAssetCategoryDirectory(category);
  const originalBase = path.parse(path.basename(String(originalName || 'image'))).name;
  const safeBase = originalBase.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-') || 'image';
  const destination = uniqueDestination(destinationDirectory, `${safeBase}-transparent.png`);
  const temporary = temporaryImagePath(destination, 'convert');
  try {
    fs.writeFileSync(temporary, pngBuffer);
    validateStandaloneImageFile(temporary, {
      fsModule: fs,
      label: `${safeBase}-transparent.png`,
      validateAsset: validateImageDecodes,
    });
    if (sha256Buffer(pngBuffer) !== sha256File(temporary, fs)) {
      throw new Error('変換後のPNGハッシュが一致しません。');
    }
    const published = publishImageTemporary(
      temporary,
      destinationDirectory,
      path.basename(destination),
    );
    const relativePath = path.relative(characterRoot, published).split(path.sep).join('/');
    return {
      relativePath,
      assetUrl: pathToFileURL(published).href,
      isJpeg: false,
    };
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function sendMascotCommand(command, value) {
  if (mascotWindow && !mascotWindow.isDestroyed()) {
    mascotWindow.webContents.send('mascot:command', { command, value });
  }
}

function rectangleIntersectionArea(first, second) {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x),
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y),
  );
  return width * height;
}

function selectDisplayForMascot(windowBounds, { preferCursor = false } = {}) {
  const displays = screen.getAllDisplays();
  if (displays.length === 0) return null;
  if (preferCursor) return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  let visibleDisplay = null;
  let largestOverlap = 0;
  for (const display of displays) {
    const overlap = rectangleIntersectionArea(windowBounds, display.workArea);
    if (overlap > largestOverlap) {
      visibleDisplay = display;
      largestOverlap = overlap;
    }
  }
  if (visibleDisplay) return visibleDisplay;
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function clearPendingRendererReadyNotification() {
  if (!pendingRendererReadyNotification) return;
  pendingRendererReadyNotification.webContents.removeListener(
    'did-finish-load',
    pendingRendererReadyNotification.listener,
  );
  pendingRendererReadyNotification = null;
}

function ensureMascotWindowOnScreen({ preferCursor = false, centerMascot = false } = {}) {
  if (!mascotWindow || mascotWindow.isDestroyed()) return false;
  const display = selectDisplayForMascot(mascotWindow.getBounds(), { preferCursor });
  if (!display) return false;

  const target = display.workArea;
  const current = mascotWindow.getBounds();
  const needsMove = current.x !== target.x
    || current.y !== target.y
    || current.width !== target.width
    || current.height !== target.height;
  if (needsMove) mascotWindow.setBounds(target, false);

  const command = centerMascot ? 'center' : 'ensure-visible';
  const notifyRenderer = () => {
    if (mascotWindow && !mascotWindow.isDestroyed()) sendMascotCommand(command);
  };
  if (mascotWindow.webContents.isLoading()) {
    const webContents = mascotWindow.webContents;
    if (pendingRendererReadyNotification?.webContents !== webContents) {
      clearPendingRendererReadyNotification();
      const pending = { webContents, command, listener: null };
      pending.listener = () => {
        if (pendingRendererReadyNotification !== pending) return;
        pendingRendererReadyNotification = null;
        if (!mascotWindow || mascotWindow.isDestroyed()) return;
        sendMascotCommand(pending.command);
      };
      pendingRendererReadyNotification = pending;
      webContents.once('did-finish-load', pending.listener);
    } else {
      pendingRendererReadyNotification.command = command;
    }
  } else if (needsMove) {
    clearPendingRendererReadyNotification();
    setTimeout(notifyRenderer, 60);
  } else {
    clearPendingRendererReadyNotification();
    notifyRenderer();
  }
  return needsMove;
}

function boundsMatchWorkArea(bounds, workArea) {
  return ['x', 'y', 'width', 'height'].every((key) => (
    Number.isFinite(bounds?.[key])
    && Number.isFinite(workArea?.[key])
    && Math.abs(bounds[key] - workArea[key]) < 1
  ));
}

function canRepairWatchdogIssue(repair) {
  const now = Date.now();
  const windowMs = RECOVERY_TIMING.watchdogRepairWindowMs;
  const history = watchdogRepairHistory.get(repair) || { attempts: [], blocked: false };
  if (history.blocked) return false;

  history.attempts = history.attempts.filter((timestamp) => now - timestamp < windowMs);
  if (history.attempts.length >= RECOVERY_TIMING.watchdogRepairLimit) {
    const count = history.attempts.length + 1;
    const cooldownMs = RECOVERY_TIMING.watchdogRepairCooldownMs;
    history.blocked = true;
    history.attempts = [];
    watchdogRepairHistory.set(repair, history);
    const timer = setTimeout(() => {
      if (watchdogRepairHistory.get(repair) === history) {
        watchdogRepairHistory.delete(repair);
      }
    }, cooldownMs);
    timer.unref?.();
    recordDiagnostic('watchdog-backoff', {
      repair,
      count,
      windowMs,
      cooldownMs,
    });
    return false;
  }

  history.attempts.push(now);
  watchdogRepairHistory.set(repair, history);
  return true;
}

function attemptMascotRendererReload() {
  if (!mascotWindow || mascotWindow.isDestroyed() || rendererReloadStopped) return false;
  const remainingCooldown = RECOVERY_TIMING.rendererReloadCooldownMs
    - (Date.now() - lastRendererReloadAt);
  if (remainingCooldown > 0) {
    if (!rendererReloadTimer) {
      rendererReloadTimer = setTimeout(() => {
        rendererReloadTimer = null;
        attemptMascotRendererReload();
      }, remainingCooldown);
      rendererReloadTimer.unref?.();
    }
    return true;
  }

  lastRendererReloadAt = Date.now();
  try {
    mascotWindow.webContents.reload();
    recordDiagnostic('renderer-reload', { reason: rendererReloadReason });
    return true;
  } catch (error) {
    recordDiagnostic('renderer-reload-failed', { reason: rendererReloadReason });
    console.warn('マスコット画面を再読み込みできませんでした。', String(error?.message || error));
    return false;
  }
}

function handleMascotRendererFailure(reason) {
  if (!mascotWindow || mascotWindow.isDestroyed() || rendererReloadStopped) return false;
  failPendingApplyRequests('マスコット画面の処理が停止しました。');
  rendererFailureCount += 1;
  rendererReloadReason = reason;
  recordDiagnostic('renderer-failure', {
    reason,
    consecutiveFailures: rendererFailureCount,
  });

  if (rendererFailureCount >= MAX_CONSECUTIVE_RENDERER_FAILURES) {
    rendererReloadStopped = true;
    clearTimeout(rendererReloadTimer);
    rendererReloadTimer = null;
    recordDiagnostic('renderer-recovery-stopped', { consecutiveFailures: rendererFailureCount });
    dialog.showErrorBox(
      'マスコットを復旧できませんでした',
      'マスコット画面が続けて停止しました。アプリを再起動してください。',
    );
    return false;
  }

  return attemptMascotRendererReload();
}

function runMascotWatchdog(reason = 'periodic') {
  if (!mascotWindow || mascotWindow.isDestroyed()) return false;
  const before = mascotWindowSnapshot();
  const bounds = mascotWindow.getBounds();
  const displays = screen.getAllDisplays();
  const matchesWorkArea = displays.some(({ workArea }) => boundsMatchWorkArea(bounds, workArea));
  const repairs = [];

  if (displays.length > 0 && !matchesWorkArea) {
    const overlapsDisplay = displays.some(
      ({ workArea }) => rectangleIntersectionArea(bounds, workArea) > 0,
    );
    const repair = overlapsDisplay ? 'bounds-do-not-match-display' : 'outside-displays';
    if (canRepairWatchdogIssue(repair) && ensureMascotWindowOnScreen()) {
      repairs.push(repair);
    }
  }

  if (!mascotWindow.isVisible() && !mascotHiddenByUser) {
    if (canRepairWatchdogIssue('unexpectedly-hidden')) {
      mascotWindow.showInactive();
      mascotWindow.setIgnoreMouseEvents(true, { forward: true });
      synchronizeMascotPassthrough();
      repairs.push('unexpectedly-hidden');
    }
  }

  if (
    (!settingsWindow || settingsWindow.isDestroyed() || !settingsWindow.isVisible())
    && typeof mascotWindow.isAlwaysOnTop === 'function'
    && !mascotWindow.isAlwaysOnTop()
  ) {
    if (canRepairWatchdogIssue('always-on-top')) {
      mascotWindow.setAlwaysOnTop(true, 'floating');
      repairs.push('always-on-top');
    }
  }

  if (repairs.length === 0) return false;
  recordDiagnostic('watchdog-repaired', {
    reason,
    repairs,
    before,
    after: mascotWindowSnapshot(),
  });
  return true;
}

function scheduleEnvironmentRecovery(reason) {
  recordDiagnostic(reason, getDisplayDiagnostics());
  clearTimeout(mascotRecoveryTimer);
  mascotRecoveryTimer = setTimeout(() => {
    mascotRecoveryTimer = null;
    lastPointerSync = null;
    runMascotWatchdog(reason);
  }, RECOVERY_TIMING.recoveryDelayMs);
  mascotRecoveryTimer.unref?.();
}

function startMascotRecoveryMonitoring() {
  if (recoveryMonitoringStarted) return;
  recoveryMonitoringStarted = true;
  recordDiagnostic('app-start', getDisplayDiagnostics());
  mascotWatchdogTimer = setInterval(
    () => runMascotWatchdog(),
    RECOVERY_TIMING.watchdogIntervalMs,
  );
  mascotWatchdogTimer.unref?.();

  screen.on('display-added', () => scheduleEnvironmentRecovery('display-added'));
  screen.on('display-removed', () => scheduleEnvironmentRecovery('display-removed'));
  screen.on('display-metrics-changed', () => scheduleEnvironmentRecovery('display-metrics-changed'));
  powerMonitor.on('resume', () => scheduleEnvironmentRecovery('resume'));
  powerMonitor.on('unlock-screen', () => scheduleEnvironmentRecovery('unlock-screen'));
}

function synchronizeMascotPassthrough() {
  if (!mascotWindow || mascotWindow.isDestroyed() || !mascotWindow.isVisible()) return false;
  try {
    const cursor = screen.getCursorScreenPoint();
    const bounds = mascotWindow.getBounds();
    const position = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    const now = Date.now();
    if (
      lastPointerSync
      && lastPointerSync.x === position.x
      && lastPointerSync.y === position.y
      && now - lastPointerSync.sentAt < POINTER_SYNC_HEARTBEAT_MS
    ) return true;
    sendMascotCommand('sync-pointer-position', position);
    lastPointerSync = { ...position, sentAt: now };
    return true;
  } catch (_error) {
    return false;
  }
}

function recallMascotToCenter() {
  if (!mascotWindow || mascotWindow.isDestroyed()) return false;
  mascotHiddenByUser = false;
  if (!mascotWindow.isVisible()) mascotWindow.showInactive();
  ensureMascotWindowOnScreen({ preferCursor: true, centerMascot: true });
  mascotWindow.setIgnoreMouseEvents(true, { forward: true });
  synchronizeMascotPassthrough();
  rebuildTrayMenu();
  return true;
}

function failPendingApplyRequests(message) {
  for (const [requestId, pending] of pendingApplyRequests) {
    clearTimeout(pending.timer);
    pending.resolve({ ok: false, error: message });
    pendingApplyRequests.delete(requestId);
  }
}

function waitForMascotRenderer(timeoutMs = 10000) {
  if (!mascotWindow || mascotWindow.isDestroyed()) createMascotWindow();
  const webContents = mascotWindow?.webContents;
  if (!webContents || webContents.isDestroyed()) {
    return Promise.reject(new Error('マスコット画面を起動できませんでした。'));
  }
  if (!webContents.isLoading()) return Promise.resolve(webContents);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      webContents.removeListener('did-finish-load', onReady);
      webContents.removeListener('did-fail-load', onFailure);
      webContents.removeListener('destroyed', onDestroyed);
    };
    const onReady = () => {
      cleanup();
      resolve(webContents);
    };
    const onFailure = (_event, _code, description) => {
      cleanup();
      reject(new Error(`マスコット画面を読み込めませんでした：${description}`));
    };
    const onDestroyed = () => {
      cleanup();
      reject(new Error('マスコット画面が終了しました。'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('マスコット画面の起動確認がタイムアウトしました。'));
    }, timeoutMs);

    webContents.once('did-finish-load', onReady);
    webContents.once('did-fail-load', onFailure);
    webContents.once('destroyed', onDestroyed);
  });
}

async function applyConfigToMascot(previewActionIndex, configHash) {
  try {
    const webContents = await waitForMascotRenderer();
    const sendApplyRequest = () => {
      const requestId = `${Date.now()}-${++applyRequestCounter}`;

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingApplyRequests.delete(requestId);
          resolve({ ok: false, error: 'マスコットから反映完了の返答がありませんでした。' });
        }, 15000);

        pendingApplyRequests.set(requestId, {
          resolve,
          timer,
          webContentsId: webContents.id,
          expectedConfigHash: configHash,
        });

        try {
          webContents.send('mascot:command', {
            command: 'reload-config',
            value: { requestId, previewActionIndex, configHash },
          });
        } catch (error) {
          clearTimeout(timer);
          pendingApplyRequests.delete(requestId);
          resolve({ ok: false, error: error.message });
        }
      });
    };

    const firstResult = await sendApplyRequest();
    return firstResult.superseded ? sendApplyRequest() : firstResult;
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function setPaused(nextPaused) {
  paused = nextPaused;
  sendMascotCommand('set-paused', paused);
  rebuildTrayMenu();
}

function toggleVisibility() {
  if (!mascotWindow || mascotWindow.isDestroyed()) return false;
  if (mascotWindow.isVisible()) {
    mascotHiddenByUser = true;
    mascotWindow.hide();
  } else {
    mascotHiddenByUser = false;
    ensureMascotWindowOnScreen();
    mascotWindow.showInactive();
    mascotWindow.setIgnoreMouseEvents(true, { forward: true });
    synchronizeMascotPassthrough();
  }
  rebuildTrayMenu();
  return true;
}

function reportWindowLoadFailure(label, fileName, error) {
  const message = String(error?.message || error || '不明なエラーです。');
  dialog.showErrorBox(
    `${label}を開けませんでした`,
    `${fileName}の読み込みに失敗しました。\n${message}\n\n画像・設定フォルダ：${getCharacterDirectory()}`,
  );
}

function loadWindowFileWithRecovery(window, fileName, label) {
  try {
    return Promise.resolve(window.loadFile(fileName)).then(
      () => true,
      (error) => {
        reportWindowLoadFailure(label, fileName, error);
        return false;
      },
    );
  } catch (error) {
    reportWindowLoadFailure(label, fileName, error);
    return Promise.resolve(false);
  }
}

function expectedWindowUrl(fileName) {
  return pathToFileURL(path.join(__dirname, fileName)).href;
}

function configureWindowSecurity(window, fileName) {
  const expectedUrl = expectedWindowUrl(fileName);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== expectedUrl) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function isTrustedWindowEvent(event, window, fileName) {
  if (!window || window.isDestroyed()) return false;
  const sender = event?.sender;
  const senderFrame = event?.senderFrame;
  if (!sender || sender !== window.webContents) return false;
  if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) return false;
  if (!senderFrame || !sender.mainFrame || senderFrame !== sender.mainFrame) return false;
  return senderFrame.url === expectedWindowUrl(fileName);
}

function assertTrustedSettingsEvent(event) {
  if (!isTrustedWindowEvent(event, settingsWindow, 'settings.html')) {
    throw new Error('この画面から設定を変更することは許可されていません。');
  }
}

function assertTrustedMascotEvent(event) {
  if (!isTrustedWindowEvent(event, mascotWindow, 'index.html')) {
    throw new Error('この画面からマスコットを操作することは許可されていません。');
  }
}

function assertTrustedApplicationEvent(event) {
  if (
    !isTrustedWindowEvent(event, settingsWindow, 'settings.html')
    && !isTrustedWindowEvent(event, mascotWindow, 'index.html')
  ) {
    throw new Error('この画面からアプリの情報を読むことは許可されていません。');
  }
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (mascotWindow && !mascotWindow.isDestroyed()) mascotWindow.setAlwaysOnTop(false);
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  if (mascotWindow && !mascotWindow.isDestroyed()) mascotWindow.setAlwaysOnTop(false);
  settingsDirty = false;
  allowSettingsClose = false;
  settingsClosePromptPending = false;

  settingsWindow = new BrowserWindow({
    width: 1120,
    height: 790,
    minWidth: 760,
    minHeight: 620,
    title: 'マスコット設定',
    backgroundColor: '#F9F8F7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const currentSettingsWindow = settingsWindow;

  configureWindowSecurity(settingsWindow, 'settings.html');
  loadWindowFileWithRecovery(settingsWindow, 'settings.html', '設定画面');
  settingsWindow.on('close', (event) => {
    const shouldPreventClose = settingsDirty && !allowSettingsClose;
    if (shouldPreventClose) event.preventDefault();
    recordQuitDiagnostic('settings-close', {
      decision: shouldPreventClose ? 'veto' : 'allow',
      dirty: settingsDirty,
      allowClose: allowSettingsClose,
      promptPending: settingsClosePromptPending,
      quitRequested,
    });
    if (!shouldPreventClose || settingsClosePromptPending) return;
    confirmSettingsClose(currentSettingsWindow);
  });
  const restoreFloatingWhenUnavailable = (reason) => {
    if (
      settingsWindow
      && !settingsWindow.isDestroyed()
      && settingsWindow.isVisible()
    ) return;
    if (settingsWindow === currentSettingsWindow && currentSettingsWindow.isDestroyed()) {
      settingsWindow = null;
      settingsDirty = false;
      allowSettingsClose = false;
      settingsClosePromptPending = false;
    }
    if (mascotWindow && !mascotWindow.isDestroyed() && !mascotWindow.isAlwaysOnTop()) {
      mascotWindow.setAlwaysOnTop(true, 'floating');
      recordDiagnostic('settings-window-unavailable', { reason });
    }
  };
  settingsWindow.on('hide', () => restoreFloatingWhenUnavailable('hidden'));
  settingsWindow.webContents.on('destroyed', () => restoreFloatingWhenUnavailable('destroyed'));
  settingsWindow.on('closed', () => {
    recordQuitDiagnostic('settings-window-closed', {
      currentWindow: settingsWindow === currentSettingsWindow,
    });
    if (settingsWindow === currentSettingsWindow) {
      settingsWindow = null;
      settingsDirty = false;
      allowSettingsClose = false;
      settingsClosePromptPending = false;
    }
    restoreFloatingWhenUnavailable('closed');
  });
}

function rebuildTrayMenu() {
  if (!tray) return;
  const isVisible = mascotWindow?.isVisible() ?? false;

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '設定を開く…', click: openSettingsWindow },
      { type: 'separator' },
      {
        label: isVisible ? 'マスコットを隠す' : 'マスコットを表示',
        click: toggleVisibility,
      },
      {
        label: paused ? '動きを再開' : '動きを一時停止',
        click: () => setPaused(!paused),
      },
      {
        label: '画面の中央へ戻す',
        click: recallMascotToCenter,
      },
      { type: 'separator' },
      { label: '画像・設定フォルダを開く', click: () => shell.openPath(getCharacterDirectory()) },
      {
        label: '診断ログを開く',
        click: () => shell.showItemInFolder(path.join(app.getPath('userData'), 'mascot-diagnostics.log')),
      },
      { label: '設定を再読み込み', click: () => sendMascotCommand('reload-config') },
      { type: 'separator' },
      { label: '終了', click: () => requestAppQuit('tray') },
    ]),
  );
}

function createMascotWindow() {
  mascotHiddenByUser = false;
  lastPointerSync = null;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;

  mascotWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-mascot.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  configureWindowSecurity(mascotWindow, 'index.html');
  mascotWindow.setIgnoreMouseEvents(true, { forward: true });
  if (process.platform === 'darwin') {
    mascotWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  loadWindowFileWithRecovery(mascotWindow, 'index.html', 'マスコット画面');
  mascotWindow.webContents.on('did-finish-load', () => {
    lastPointerSync = null;
    clearTimeout(unresponsiveTimer);
    clearTimeout(rendererReloadTimer);
    unresponsiveTimer = null;
    rendererReloadTimer = null;
    rendererIsUnresponsive = false;
    rendererFailureCount = 0;
    rendererReloadStopped = false;
    ensureMascotWindowOnScreen();
    sendMascotCommand('set-paused', paused);
    synchronizeMascotPassthrough();
    recordDiagnostic('renderer-ready');
  });
  mascotWindow.on('show', () => {
    lastPointerSync = null;
    rebuildTrayMenu();
    synchronizeMascotPassthrough();
  });
  mascotWindow.on('move', () => { lastPointerSync = null; });
  mascotWindow.on('hide', rebuildTrayMenu);
  mascotWindow.on('close', () => {
    recordQuitDiagnostic('mascot-close', { quitRequested });
  });
  mascotWindow.on('closed', () => {
    clearPendingRendererReadyNotification();
    lastPointerSync = null;
    recordQuitDiagnostic('mascot-closed', { quitRequested });
    clearTimeout(unresponsiveTimer);
    clearTimeout(rendererReloadTimer);
    unresponsiveTimer = null;
    rendererReloadTimer = null;
    rendererIsUnresponsive = false;
    rendererFailureCount = 0;
    rendererReloadStopped = false;
    mascotWindow = null;
    mascotHiddenByUser = false;
    failPendingApplyRequests('マスコット画面が閉じられました。');
    rebuildTrayMenu();
  });
  mascotWindow.on('unresponsive', () => {
    rendererIsUnresponsive = true;
    recordDiagnostic('renderer-unresponsive');
    clearTimeout(unresponsiveTimer);
    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = null;
      if (rendererIsUnresponsive) handleMascotRendererFailure('unresponsive');
    }, RECOVERY_TIMING.unresponsiveTimeoutMs);
    unresponsiveTimer.unref?.();
  });
  mascotWindow.on('responsive', () => {
    rendererIsUnresponsive = false;
    clearTimeout(unresponsiveTimer);
    unresponsiveTimer = null;
    recordDiagnostic('renderer-responsive');
  });
  mascotWindow.webContents.on('render-process-gone', () => {
    rendererIsUnresponsive = false;
    clearTimeout(unresponsiveTimer);
    unresponsiveTimer = null;
    handleMascotRendererFailure('render-process-gone');
  });
  mascotWindow.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (isMainFrame === false || errorCode === -3) return;
    recordDiagnostic('did-fail-load', { errorCode });
    handleMascotRendererFailure('did-fail-load');
  });
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('🪼');
  tray.setToolTip('Desktop Mascot');
  rebuildTrayMenu();
}

function registerIpcHandler(channel, access, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (access === 'settings') assertTrustedSettingsEvent(event);
    else if (access === 'mascot') assertTrustedMascotEvent(event);
    else if (access === 'application') assertTrustedApplicationEvent(event);
    else throw new Error(`IPC権限分類が正しくありません：${access}`);
    return handler(event, ...args);
  });
}

ipcMain.on('mascot:set-mouse-passthrough', (event, ignore) => {
  if (!isTrustedWindowEvent(event, mascotWindow, 'index.html')) return;
  mascotWindow.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
});

ipcMain.on('mascot:settings-dirty', (event, dirty) => {
  if (!isTrustedWindowEvent(event, settingsWindow, 'settings.html')) return;
  settingsDirty = Boolean(dirty);
});

ipcMain.on('mascot:apply-result', (event, payload) => {
  if (!isTrustedWindowEvent(event, mascotWindow, 'index.html')) return;
  const requestId = String(payload?.requestId || '');
  const pending = pendingApplyRequests.get(requestId);
  if (!pending || pending.webContentsId !== event.sender.id) return;

  clearTimeout(pending.timer);
  pendingApplyRequests.delete(requestId);
  const appliedHash = String(payload?.appliedHash || '');
  const hashMatches = Boolean(payload?.ok)
    && appliedHash.length === 64
    && appliedHash === pending.expectedConfigHash;
  pending.resolve({
    ok: hashMatches,
    superseded: Boolean(payload?.superseded),
    error: hashMatches
      ? null
      : (payload?.ok
        ? '保存した設定と実際に表示した設定のハッシュが一致しません。'
        : String(payload?.error || '設定を反映できませんでした。')),
    actionName: payload?.actionName ? String(payload.actionName) : null,
    appliedHash: appliedHash || null,
  });
});

ipcMain.on('mascot:diagnostic', (event, diagnosticType) => {
  if (!isTrustedWindowEvent(event, mascotWindow, 'index.html')) return;
  if (!RENDERER_DIAGNOSTIC_TYPES.has(diagnosticType)) return;
  recordDiagnostic('renderer-error', { kind: diagnosticType });
});

registerIpcHandler('mascot:load-config', 'application', () => loadMascotRuntimeConfig());
registerIpcHandler('mascot:load-editable-config', 'settings', () => loadEditableConfig());
registerIpcHandler('mascot:recover-config', 'settings', (_event, strategy) => {
  return recoverEditableConfig(strategy);
});

registerIpcHandler('mascot:resolve-asset', 'application', (_event, relativePath) => {
  return resolveCharacterAsset(relativePath);
});

registerIpcHandler('mascot:get-asset-metadata', 'settings', (_event, relativePath) => {
  return getCharacterAssetMetadata(relativePath);
});

registerIpcHandler('mascot:choose-image', 'settings', async (_event, category) => {
  const result = await dialog.showOpenDialog(settingsWindow || mascotWindow, {
    title: category === 'effects' ? 'エフェクト画像を選ぶ' : 'キャラクター画像を選ぶ',
    properties: ['openFile'],
    filters: [
      { name: '画像', extensions: ['gif', 'png', 'webp', 'svg', 'jpg', 'jpeg'] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return importImageFromPath(result.filePaths[0], category);
});

registerIpcHandler('mascot:register-dropped-path', 'settings', (_event, filePath) => {
  return registerDroppedPath(filePath);
});

registerIpcHandler('mascot:import-image', 'settings', (_event, { sourcePath, category }) => {
  return importImageFromPath(consumeDroppedPath(sourcePath), category);
});

registerIpcHandler('mascot:discard-imported-image', 'settings', (_event, relativePath, category) => {
  return discardImportedImage(relativePath, category);
});

registerIpcHandler('mascot:save-transparent-png', 'settings', (_event, payload) => {
  return saveTransparentPng(
    payload?.arrayBuffer,
    payload?.category,
    payload?.originalName,
  );
});

registerIpcHandler('mascot:get-app-info', 'settings', () => ({ isPackaged: app.isPackaged }));

function prepareDistributionDefaultsForDevelopment() {
  if (app.isPackaged) {
    throw new Error('この操作は開発用プロジェクトでのみ使用できます。');
  }
  recoverDevelopmentDistributionDefaults();
  const { config, characterDirectory } = loadNormalizedConfig({ persistMigration: false });
  const destinationRoot = getBundledCharacterDirectory();
  return replaceDirectoryTransaction({
    sourceRoot: characterDirectory,
    destinationRoot,
    config,
    fsModule: fs,
    validateAsset: validateImageDecodes,
  });
}

registerIpcHandler('mascot:prepare-distribution-defaults', 'settings', () => {
  try {
    const result = prepareDistributionDefaultsForDevelopment();
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      error: `配布用設定を準備できませんでした：${String(error?.message || error)}`,
      recoveryPath: getBundledCharacterDirectory(),
    };
  }
});

registerIpcHandler('mascot:save-config', 'settings', async (_event, payload) => {
  const input = payload?.config;
  const config = validateAndNormalizeConfig(input);
  const requestedIndex = payload?.previewActionIndex;
  const previewActionIndex = Number.isInteger(requestedIndex)
    && requestedIndex >= 0
    && requestedIndex < config.actions.length
    ? requestedIndex
    : null;

  writeConfigAtomic(config);
  const savedHash = hashNormalizedConfig(config);
  const applyResult = await applyConfigToMascot(previewActionIndex, savedHash);
  return {
    ok: true,
    applied: applyResult.ok,
    applyError: applyResult.error || null,
    actionName: applyResult.actionName || null,
    savedHash,
    appliedHash: applyResult.appliedHash || null,
    config,
  };
});

function startApplication() {
  if (process.platform !== 'darwin') {
    dialog.showErrorBox('対応していないOSです', 'Desktop Mascot は現在 macOS 専用です。');
    requestAppQuit('unsupported-platform');
    return;
  }

  ensureCharacterDirectory();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
  createMascotWindow();
  createTray();
  startMascotRecoveryMonitoring();
  clearInterval(pointerSyncTimer);
  pointerSyncTimer = setInterval(synchronizeMascotPassthrough, 750);
  pointerSyncTimer.unref?.();
  if (app.dock) app.dock.hide();
}

function reportStartupFailure(error) {
  dialog.showErrorBox(
    'マスコットを起動できませんでした',
    `画像・設定の準備に失敗しました。既存データは自動削除していません。\n${String(error?.message || error)}\n\n画像・設定フォルダ：${getCharacterDirectory()}`,
  );
  requestAppQuit('startup-failure');
}

if (hasSingleInstanceLock) {
  app.on('second-instance', openSettingsWindow);
  app.whenReady().then(startApplication).catch(reportStartupFailure);
  app.on('activate', () => {
    if (!mascotWindow) createMascotWindow();
    else {
      mascotHiddenByUser = false;
      ensureMascotWindowOnScreen();
      mascotWindow.showInactive();
      synchronizeMascotPassthrough();
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') requestAppQuit('last-window-closed');
  });
} else {
  requestAppQuit('single-instance-lock-denied');
}

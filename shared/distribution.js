'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { resolveImageFileWithinRoot } = require('./asset-validation');
const {
  buildAndValidateStaging,
  collectReferencedAssetPaths,
  listTreeFiles,
} = require('./distribution-defaults');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANIFEST_NAME = 'manifest.json';
const DISTRIBUTION_BUNDLE_PREFIX = 'com.github.onoayami.desktopmascot.dist.';

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJsonValue(value[key])]),
    );
  }
  return value;
}

function assertPlainFile(filePath, label, fsModule = fs) {
  const stat = fsModule.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label}が通常ファイルではありません。`);
  }
}

function assertPlainDirectory(directoryPath, label, fsModule = fs) {
  const stat = fsModule.lstatSync(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label}が通常のフォルダではありません。`);
  }
}

function readDistributionDefaults(resourcesPath, {
  fsModule = fs,
  validateConfig = (config) => config,
  validateAsset,
} = {}) {
  const root = path.join(resourcesPath, 'distribution-defaults');
  try {
    fsModule.lstatSync(root);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const rootStat = fsModule.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('配布版の初期設定フォルダが正しくありません。');
  }

  const manifestPath = path.join(root, MANIFEST_NAME);
  const configPath = path.join(root, 'config.json');
  try {
    assertPlainFile(manifestPath, '配布版マニフェスト', fsModule);
    assertPlainFile(configPath, '配布版設定', fsModule);
    const manifest = JSON.parse(fsModule.readFileSync(manifestPath, 'utf8'));
    if (
      !manifest
      || typeof manifest !== 'object'
      || Array.isArray(manifest)
      || Object.keys(manifest).sort().join(',') !== 'id,name'
      || typeof manifest.id !== 'string'
      || !UUID_PATTERN.test(manifest.id)
      || typeof manifest.name !== 'string'
      || manifest.name.trim() === ''
    ) {
      throw new Error('配布版マニフェストの形式が正しくありません。');
    }

    const rawConfig = JSON.parse(fsModule.readFileSync(configPath, 'utf8'));
    const validated = validateConfig(rawConfig);
    const config = validated?.config || validated;
    if (!config || !Array.isArray(config.actions)) {
      throw new Error('配布版設定の形式が正しくありません。');
    }
    if (JSON.stringify(canonicalJsonValue(config)) !== JSON.stringify(canonicalJsonValue(rawConfig))) {
      throw new Error('配布版設定に不足または未対応の項目があります。');
    }
    if (config.name !== manifest.name) {
      throw new Error('配布版マニフェストと設定の名前が一致しません。');
    }
    const referencedAssets = collectReferencedAssetPaths(config);
    for (const relativePath of referencedAssets) {
      resolveImageFileWithinRoot(root, relativePath, { fsModule, validateAsset });
    }
    const expectedFiles = [MANIFEST_NAME, 'config.json', ...referencedAssets]
      .sort((left, right) => left.localeCompare(right));
    const actualFiles = listTreeFiles(root, fsModule);
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
      throw new Error('配布版初期設定に不足または未参照のファイルがあります。');
    }
    return { id: manifest.id.toLowerCase(), name: manifest.name, root, config };
  } catch (error) {
    throw new Error(`配布版の初期設定を読み込めません：${error.message}`, { cause: error });
  }
}

function distributionUserDataName(id) {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new Error('配布版IDが正しくありません。');
  }
  return `Desktop Mascot-distribution-${id.toLowerCase()}`;
}

function bundleRootFromExecutable(executablePath) {
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const markerIndex = executablePath.lastIndexOf(marker);
  if (markerIndex < 0 || !executablePath.slice(0, markerIndex).endsWith('.app')) {
    throw new Error('配布版を作成できません。このアプリはmacOSアプリケーションフォルダから起動してください。');
  }
  const bundlePath = executablePath.slice(0, markerIndex);
  const relativeExecutable = path.relative(
    path.join(bundlePath, 'Contents', 'MacOS'),
    executablePath,
  );
  if (!relativeExecutable || relativeExecutable.startsWith('..') || path.isAbsolute(relativeExecutable)) {
    throw new Error('実行中のアプリケーション位置を確認できません。');
  }
  return bundlePath;
}

function readBundleIdentifier(executablePath, {
  execFileSync = require('child_process').execFileSync,
} = {}) {
  const bundlePath = bundleRootFromExecutable(executablePath);
  const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');
  try {
    const identifier = execFileSync(
      '/usr/bin/plutil',
      ['-extract', 'CFBundleIdentifier', 'raw', plistPath],
      { encoding: 'utf8', timeout: 5000 },
    ).trim();
    if (!identifier) throw new Error('CFBundleIdentifierがありません。');
    return identifier;
  } catch (error) {
    throw new Error(`アプリの識別情報を確認できません：${error.message}`, { cause: error });
  }
}

function distributionIdFromBundleIdentifier(identifier) {
  if (!identifier.startsWith(DISTRIBUTION_BUNDLE_PREFIX)) return null;
  const compactId = identifier.slice(DISTRIBUTION_BUNDLE_PREFIX.length);
  if (!/^[0-9a-f]{32}$/i.test(compactId)) {
    throw new Error('配布版のアプリ識別情報が正しくありません。');
  }
  const id = [
    compactId.slice(0, 8),
    compactId.slice(8, 12),
    compactId.slice(12, 16),
    compactId.slice(16, 20),
    compactId.slice(20),
  ].join('-').toLowerCase();
  if (!UUID_PATTERN.test(id)) throw new Error('配布版のアプリ識別情報が正しくありません。');
  return id;
}

function safeBundleName(name) {
  const safeName = String(name || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/[\s.]+$/u, '')
    .slice(0, 40)
    .trim();
  return `Desktop Mascot${safeName ? ` - ${safeName}` : ''}.app`;
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function runNative(execFileAsync, executable, args, label, timeout = 20 * 60 * 1000) {
  return execFileAsync(executable, args, {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  }).catch((error) => {
    const detail = String(error?.stderr || error?.message || '').trim().slice(0, 1500);
    throw new Error(`${label}に失敗しました${detail ? `：${detail}` : ''}`, { cause: error });
  });
}

async function createDistributionArchive({
  dialog,
  parentWindow,
  executablePath,
  appIsPackaged,
  userDataPath,
  characterRoot,
  config: suppliedConfig,
  loadExportData,
  fsModule = fs,
  osModule = os,
  execFileAsync = promisify(require('child_process').execFile),
  randomId = crypto.randomUUID,
  validateAsset,
  platform = process.platform,
}) {
  if (!appIsPackaged || platform !== 'darwin') {
    throw new Error('配布版作成はmacOSにインストールしたアプリから利用できます。');
  }

  const sourceBundle = bundleRootFromExecutable(executablePath);
  const sourceBundleReal = fsModule.realpathSync(sourceBundle);
  if (!fsModule.statSync(sourceBundleReal).isDirectory()) {
    throw new Error('実行中のアプリケーションを確認できません。');
  }
  const dialogResult = await dialog.showSaveDialog(parentWindow, {
    title: '配布用ZIPを保存',
    buttonLabel: '配布用ZIPを作成',
    defaultPath: path.join(osModule.homedir(), 'Desktop Mascot 配布版.zip'),
    filters: [{ name: 'ZIPアーカイブ', extensions: ['zip'] }],
  });
  if (dialogResult.canceled || !dialogResult.filePath) return { canceled: true };

  const exportData = suppliedConfig
    ? { config: suppliedConfig, characterRoot }
    : await loadExportData();
  const { config } = exportData || {};
  const assetsRoot = exportData?.characterRoot;
  if (!config || !assetsRoot) throw new Error('保存済み設定を読み込めません。');

  const destinationPath = path.resolve(dialogResult.filePath);
  if (path.extname(destinationPath).toLowerCase() !== '.zip') {
    throw new Error('保存先のファイル名は .zip にしてください。');
  }
  const destinationParent = fsModule.realpathSync(path.dirname(destinationPath));
  const destination = path.join(destinationParent, path.basename(destinationPath));
  if (pathIsWithin(sourceBundleReal, destination)) {
    throw new Error('元のアプリの中には保存できません。別の保存先を選んでください。');
  }
  const protectedRoots = [userDataPath, assetsRoot].map((root) => {
    try {
      return fsModule.realpathSync(root);
    } catch (error) {
      throw new Error(`保護対象フォルダの場所を確認できません：${error.message}`, { cause: error });
    }
  });
  if (protectedRoots.some((root) => pathIsWithin(root, destination))) {
    throw new Error('設定や画像の保存フォルダには保存できません。別の保存先を選んでください。');
  }
  if (fsModule.existsSync(destination)) {
    const existing = fsModule.lstatSync(destination);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error('保存先に通常のZIPファイル以外があるため、上書きできません。');
    }
  }

  const distributionId = randomId().toLowerCase();
  if (!UUID_PATTERN.test(distributionId)) throw new Error('配布版IDを作成できませんでした。');
  const temporaryZip = path.join(
    destinationParent,
    `.${path.basename(destinationPath, '.zip')}-${distributionId}.zip`,
  );
  if (fsModule.existsSync(temporaryZip)) {
    throw new Error('配布版のZIP作業ファイルを確保できません。別の保存先を選んでください。');
  }
  const workingRoot = path.join(destinationParent, `.desktop-mascot-distribution-${distributionId}`);
  if (fsModule.existsSync(workingRoot)) {
    throw new Error('配布版の作業場所を確保できません。別の保存先を選んでください。');
  }
  fsModule.mkdirSync(workingRoot, { recursive: false });
  const appCopy = path.join(workingRoot, safeBundleName(config?.name));
  const resourcesPath = path.join(appCopy, 'Contents', 'Resources');
  const defaultsPath = path.join(resourcesPath, 'distribution-defaults');
  const plistPath = path.join(appCopy, 'Contents', 'Info.plist');
  let published = false;
  let failure = null;

  try {
    await runNative(execFileAsync, '/usr/bin/ditto', [sourceBundleReal, appCopy], 'アプリのコピー');
    assertPlainDirectory(appCopy, 'コピーしたアプリ', fsModule);
    assertPlainDirectory(path.join(appCopy, 'Contents'), 'コピーしたアプリのContents', fsModule);
    assertPlainDirectory(resourcesPath, 'コピーしたアプリのResources', fsModule);
    fsModule.rmSync(defaultsPath, { recursive: true, force: true });
    const packagedDefaults = path.join(workingRoot, 'distribution-defaults');
    fsModule.mkdirSync(packagedDefaults);
    const staged = buildAndValidateStaging({
      sourceRoot: assetsRoot,
      stagingRoot: path.join(packagedDefaults, 'assets'),
      config,
      fsModule,
      validateAsset,
    });
    fsModule.renameSync(path.join(packagedDefaults, 'assets'), defaultsPath);
    fsModule.writeFileSync(
      path.join(defaultsPath, MANIFEST_NAME),
      `${JSON.stringify({ id: distributionId, name: config.name }, null, 2)}\n`,
      { flag: 'wx', encoding: 'utf8' },
    );
    if (!fsModule.existsSync(plistPath)) throw new Error('アプリの設定ファイルInfo.plistがありません。');
    assertPlainFile(plistPath, 'アプリの設定ファイルInfo.plist', fsModule);
    const bundleIdentifier = `com.github.onoayami.desktopmascot.dist.${distributionId.replace(/-/gu, '')}`;
    await runNative(execFileAsync, '/usr/bin/plutil', [
      '-replace', 'CFBundleIdentifier', '-string', bundleIdentifier, plistPath,
    ], '配布版の識別情報設定');
    await runNative(execFileAsync, '/usr/bin/codesign', [
      '--force', '--deep', '--sign', '-', appCopy,
    ], '配布版の署名');
    await runNative(execFileAsync, '/usr/bin/codesign', [
      '--verify', '--deep', '--strict', appCopy,
    ], '配布版の署名検証');
    await runNative(execFileAsync, '/usr/bin/ditto', [
      '-c', '-k', '--keepParent', appCopy, temporaryZip,
    ], 'ZIPの作成');
    assertPlainFile(temporaryZip, '作成したZIP', fsModule);
    if (fsModule.statSync(temporaryZip).size === 0) throw new Error('ZIPが空のため、配布版を作成できません。');
    const stagedFiles = listTreeFiles(defaultsPath, fsModule)
      .filter((entry) => entry !== MANIFEST_NAME);
    if (stagedFiles.length !== staged.files.length) {
      throw new Error('配布版の設定データを確認できません。');
    }
    await fsModule.promises.rm(workingRoot, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
    fsModule.renameSync(temporaryZip, destination);
    published = true;
    return { canceled: false, filePath: destination, id: distributionId };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    for (const candidate of [workingRoot, ...(published ? [] : [temporaryZip])]) {
      try {
        await fsModule.promises.rm(candidate, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length) {
      const cleanupMessage = cleanupErrors.map((error) => error.message).join('；').slice(0, 1500);
      if (failure) {
        failure.message += `\n作業ファイルの整理にも失敗しました：${cleanupMessage}`;
      } else {
        throw new Error(`作業ファイルの整理に失敗したため、配布版の作成結果を確定できません：${cleanupMessage}`);
      }
    }
  }
}

module.exports = {
  bundleRootFromExecutable,
  createDistributionArchive,
  distributionIdFromBundleIdentifier,
  distributionUserDataName,
  readBundleIdentifier,
  readDistributionDefaults,
  safeBundleName,
};

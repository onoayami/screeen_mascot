'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  normalizeRelativeImagePath,
  resolveImageFileWithinRoot,
  sha256File,
  validateImageSignature,
} = require('./asset-validation');

const normalizeRelativeAssetPath = normalizeRelativeImagePath;

function collectReferencedAssetPaths(config) {
  if (!config || typeof config !== 'object' || !Array.isArray(config.actions) || config.actions.length === 0) {
    throw new Error('配布用設定に動作がありません。');
  }
  const paths = new Set();
  config.actions.forEach((action, index) => {
    if (!action || typeof action !== 'object') {
      throw new Error(`配布用設定の動作${index + 1}が正しくありません。`);
    }
    paths.add(normalizeRelativeAssetPath(action.file));
    if (action.effect && typeof action.effect === 'object' && action.effect.file) {
      paths.add(normalizeRelativeAssetPath(action.effect.file));
    }
  });
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function resolveRegularAsset(sourceRoot, relativePath, fsModule = fs) {
  return resolveImageFileWithinRoot(sourceRoot, relativePath, { fsModule });
}

function listTreeFiles(root, fsModule = fs) {
  if (!fsModule.existsSync(root)) return [];
  const rows = [];
  const walk = (directory) => {
    for (const entry of fsModule.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath).split(path.sep).join('/');
      if (entry.isSymbolicLink()) throw new Error(`stagingにシンボリックリンクがあります：${relativePath}`);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) rows.push(relativePath);
      else throw new Error(`stagingに通常ファイル以外があります：${relativePath}`);
    }
  };
  walk(root);
  return rows.sort((left, right) => left.localeCompare(right));
}

function readConfigFromRoot(sourceRoot, fsModule = fs) {
  const configPath = path.join(sourceRoot, 'config.json');
  try {
    const config = JSON.parse(fsModule.readFileSync(configPath, 'utf8'));
    collectReferencedAssetPaths(config);
    return config;
  } catch (error) {
    throw new Error(`配布用設定を読み込めません：${error.message}`);
  }
}

function validateAssetFile(filePath, relativePath, fsModule, validateAsset) {
  validateImageSignature(filePath, relativePath, fsModule);
  if (typeof validateAsset === 'function') validateAsset(filePath, relativePath);
}

function buildAndValidateStaging({
  sourceRoot,
  stagingRoot,
  config,
  fsModule = fs,
  validateAsset,
}) {
  const referencedAssets = collectReferencedAssetPaths(config);
  fsModule.mkdirSync(stagingRoot, { recursive: false });
  fsModule.writeFileSync(
    path.join(stagingRoot, 'config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );

  for (const relativePath of referencedAssets) {
    const sourceFile = resolveRegularAsset(sourceRoot, relativePath, fsModule);
    validateAssetFile(sourceFile, relativePath, fsModule, validateAsset);
    const destinationFile = path.join(stagingRoot, ...relativePath.split('/'));
    fsModule.mkdirSync(path.dirname(destinationFile), { recursive: true });
    fsModule.copyFileSync(sourceFile, destinationFile);
    const copiedStat = fsModule.lstatSync(destinationFile);
    if (copiedStat.isSymbolicLink() || !copiedStat.isFile()) {
      throw new Error(`コピー後の画像が通常ファイルではありません：${relativePath}`);
    }
    validateAssetFile(destinationFile, relativePath, fsModule, validateAsset);
    if (sha256File(sourceFile, fsModule) !== sha256File(destinationFile, fsModule)) {
      throw new Error(`コピー後の画像ハッシュが一致しません：${relativePath}`);
    }
  }

  const stagedConfig = JSON.parse(fsModule.readFileSync(path.join(stagingRoot, 'config.json'), 'utf8'));
  if (JSON.stringify(stagedConfig) !== JSON.stringify(config)) {
    throw new Error('stagingの設定内容が保存前と一致しません。');
  }
  const stagedReferences = collectReferencedAssetPaths(stagedConfig);
  if (JSON.stringify(stagedReferences) !== JSON.stringify(referencedAssets)) {
    throw new Error('stagingの画像参照が保存前と一致しません。');
  }
  const expectedFiles = ['config.json', ...referencedAssets].sort((left, right) => left.localeCompare(right));
  const actualFiles = listTreeFiles(stagingRoot, fsModule);
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error('stagingに未参照ファイルまたは不足ファイルがあります。');
  }
  return { referencedAssets, files: actualFiles };
}

function transactionPaths(destinationRoot) {
  return {
    backupRoot: `${destinationRoot}.backup`,
    stagingPrefix: `${path.basename(destinationRoot)}.staging-`,
  };
}

function listStagingDirectories(destinationRoot, fsModule = fs) {
  const parent = path.dirname(destinationRoot);
  if (!fsModule.existsSync(parent)) return [];
  const { stagingPrefix } = transactionPaths(destinationRoot);
  return fsModule.readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.name.startsWith(stagingPrefix))
    .map((entry) => path.join(parent, entry.name));
}

function removePath(target, fsModule = fs) {
  if (fsModule.existsSync(target)) fsModule.rmSync(target, { recursive: true, force: true });
}

function recoverDirectoryTransaction({ destinationRoot, fsModule = fs }) {
  const { backupRoot } = transactionPaths(destinationRoot);
  const stagingRoots = listStagingDirectories(destinationRoot, fsModule);
  let restoredBackup = false;

  if (!fsModule.existsSync(destinationRoot) && fsModule.existsSync(backupRoot)) {
    fsModule.renameSync(backupRoot, destinationRoot);
    restoredBackup = true;
  }
  for (const stagingRoot of stagingRoots) removePath(stagingRoot, fsModule);

  return {
    destinationRoot,
    backupRoot,
    restoredBackup,
    removedStagingCount: stagingRoots.length,
  };
}

function replaceDirectoryTransaction({
  sourceRoot,
  destinationRoot,
  config,
  fsModule = fs,
  randomId = crypto.randomUUID,
  validateAsset,
}) {
  fsModule.mkdirSync(path.dirname(destinationRoot), { recursive: true });
  recoverDirectoryTransaction({ destinationRoot, fsModule });
  const { backupRoot } = transactionPaths(destinationRoot);
  const stagingRoot = `${destinationRoot}.staging-${randomId()}`;
  let movedExistingDestination = false;

  try {
    const staged = buildAndValidateStaging({
      sourceRoot,
      stagingRoot,
      config,
      fsModule,
      validateAsset,
    });

    if (fsModule.existsSync(destinationRoot)) {
      removePath(backupRoot, fsModule);
      fsModule.renameSync(destinationRoot, backupRoot);
      movedExistingDestination = true;
    }
    fsModule.renameSync(stagingRoot, destinationRoot);
    return {
      destinationRoot,
      backupRoot: movedExistingDestination ? backupRoot : null,
      includedFiles: staged.files,
      referencedAssets: staged.referencedAssets,
    };
  } catch (error) {
    let rollbackError = null;
    if (movedExistingDestination && !fsModule.existsSync(destinationRoot) && fsModule.existsSync(backupRoot)) {
      try {
        fsModule.renameSync(backupRoot, destinationRoot);
      } catch (caught) {
        rollbackError = caught;
      }
    }
    try {
      removePath(stagingRoot, fsModule);
    } catch (cleanupError) {
      if (!rollbackError) rollbackError = cleanupError;
    }
    if (rollbackError) {
      const combined = new Error(
        `配布用データの更新に失敗し、自動復元も完了できませんでした。backupを保護しています：${backupRoot} (${rollbackError.message})`,
      );
      combined.cause = error;
      combined.backupRoot = backupRoot;
      throw combined;
    }
    throw error;
  }
}

function installDefaultsFromSource({
  sourceRoot,
  destinationRoot,
  fsModule = fs,
  randomId = crypto.randomUUID,
  validateAsset,
}) {
  const config = readConfigFromRoot(sourceRoot, fsModule);
  return replaceDirectoryTransaction({
    sourceRoot,
    destinationRoot,
    config,
    fsModule,
    randomId,
    validateAsset,
  });
}

function replaceFileAtomically({
  sourceFile,
  destinationFile,
  relativePath,
  fsModule = fs,
  randomId = crypto.randomUUID,
  validateAsset,
}) {
  const extension = path.extname(destinationFile);
  const baseName = path.basename(destinationFile, extension);
  const temporaryFile = path.join(
    path.dirname(destinationFile),
    `.${baseName}.migrate-${randomId()}${extension}`,
  );
  const backupFile = `${destinationFile}.migrate-backup`;
  let movedExisting = false;
  try {
    fsModule.copyFileSync(sourceFile, temporaryFile);
    validateAssetFile(temporaryFile, relativePath, fsModule, validateAsset);
    if (sha256File(sourceFile, fsModule) !== sha256File(temporaryFile, fsModule)) {
      throw new Error(`移行用画像のハッシュが一致しません：${relativePath}`);
    }
    removePath(backupFile, fsModule);
    fsModule.renameSync(destinationFile, backupFile);
    movedExisting = true;
    fsModule.renameSync(temporaryFile, destinationFile);
    try {
      removePath(backupFile, fsModule);
    } catch {
      // The new file is already committed. Keeping the backup is safer than
      // reporting a failed migration and attempting to undo a completed swap.
    }
    return destinationFile;
  } catch (error) {
    if (movedExisting && !fsModule.existsSync(destinationFile) && fsModule.existsSync(backupFile)) {
      try {
        fsModule.renameSync(backupFile, destinationFile);
      } catch (rollbackError) {
        const combined = new Error(
          `旧素材の移行に失敗し、自動復元も完了できませんでした：${relativePath} (${rollbackError.message})`,
        );
        combined.cause = error;
        throw combined;
      }
    }
    removePath(temporaryFile, fsModule);
    throw error;
  }
}

module.exports = {
  buildAndValidateStaging,
  collectReferencedAssetPaths,
  installDefaultsFromSource,
  listTreeFiles,
  normalizeRelativeAssetPath,
  readConfigFromRoot,
  recoverDirectoryTransaction,
  replaceDirectoryTransaction,
  replaceFileAtomically,
  resolveRegularAsset,
  sha256File,
  transactionPaths,
  validateImageSignature,
};

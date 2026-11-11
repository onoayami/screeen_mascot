import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helperDirectory = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(helperDirectory, '../../..');
export const BASELINE_MANIFEST_PATH = path.join(
  PROJECT_ROOT,
  'tests',
  'phase0',
  'fixtures',
  'v2.3.4-baseline-manifest.json',
);
export const BASELINE_PACKAGE_PATH = path.join(
  PROJECT_ROOT,
  'tests',
  'phase0',
  'fixtures',
  'package.v2.3.4.json',
);

const BASELINE_TAG = 'v2.3.4-baseline';
const BASELINE_FILE_COUNT = 36;
const BASELINE_TOTAL_BYTES = 1046306;
const PROJECT_SNAPSHOT_EXCLUDES = Object.freeze(['.git', 'node_modules']);
const APPROVED_RUNTIME_BUILD_FILES = Object.freeze([
  'shared/**/*',
  'preload-mascot.js',
]);
const APPROVED_TEST_SCRIPTS = Object.freeze({
  'test:smoke': 'electron scripts/smoke-native-image.js',
  'test:phase0:harness': 'node --test tests/phase0/harness.test.mjs',
  'test:phase0:known-defects': 'node --test tests/phase0/known-defects.test.mjs',
  'test:phase0': 'npm run test:phase0:harness && npm run test:phase0:known-defects',
  'test:release-a1': 'node --test tests/release-a1/*.test.mjs',
  'test:release-a2': 'node --test tests/release-a2/*.test.mjs',
  'test:release-a3': 'node --test tests/release-a3/*.test.mjs',
  'test:release-b': 'node --test tests/release-b/*.test.mjs',
  'test:release-c': 'node --test tests/release-c/*.test.mjs',
  'test:release-d': 'node --test tests/release-d/*.test.mjs',
  'test:automated': 'npm run check && npm run test:phase0:harness && npm run test:phase0:known-defects && npm run test:release-a1 && npm run test:release-a2 && npm run test:release-a3 && npm run test:release-b && npm run test:release-c && npm run test:release-d',
  'test:automated:local': 'node scripts/run-automated-tests.mjs',
});
const APPROVED_CHECK_SCRIPT = 'node scripts/check-config.js && node scripts/check-release-text.js';
const APPROVED_BUILD_SCRIPTS = Object.freeze({
  'build:mac': 'npm run check:build-lock && npm run check && electron-builder --mac --publish never',
  'build:mac:arm64': 'npm run check:build-lock && npm run check && electron-builder --mac --arm64 --publish never',
  'build:mac:x64': 'npm run check:build-lock && npm run check && electron-builder --mac --x64 --publish never',
  'build:mac:universal': 'npm run check:build-lock && npm run check && electron-builder --mac --universal --publish never',
});
const APPROVED_RELEASE_SCRIPTS = Object.freeze({
  'check:build-lock': 'node scripts/check-build-lock.js',
  'check:release-text': 'node scripts/check-release-text.js',
  'package:source': 'npm run check && python3 scripts/create-source-zip.py',
});
const APPROVED_RELEASE_METADATA = Object.freeze({
  author: 'onoayami',
  appId: 'com.github.onoayami.desktopmascot',
  version: '1.0.0',
  devDependencies: Object.freeze({
    electron: '45.2.3',
    'electron-builder': '26.18.0',
  }),
});
const EXACT_DEPENDENCY_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

export function loadBaselineManifest() {
  return JSON.parse(fs.readFileSync(BASELINE_MANIFEST_PATH, 'utf8'));
}

export function manifestForPaths(root, rows = loadBaselineManifest()) {
  return rows.map((row) => {
    const filePath = path.join(root, row.path);
    return {
      path: row.path,
      size: fs.existsSync(filePath) ? fs.statSync(filePath).size : null,
      sha256: fs.existsSync(filePath) ? sha256File(filePath) : null,
    };
  });
}

export function assertPackageOnlyAddsApprovedReleaseChanges(projectRoot = PROJECT_ROOT) {
  const baselinePackagePath = path.join(projectRoot, 'tests', 'phase0', 'fixtures', 'package.v2.3.4.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePackagePath, 'utf8'));
  const current = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  assert.equal(current.scripts?.check, APPROVED_CHECK_SCRIPT, 'unexpected check script');
  current.scripts.check = baseline.scripts.check;
  for (const [scriptName, command] of Object.entries(APPROVED_RELEASE_SCRIPTS)) {
    assert.equal(current.scripts?.[scriptName], command, `unexpected ${scriptName}`);
    delete current.scripts[scriptName];
  }
  for (const [scriptName, command] of Object.entries(APPROVED_BUILD_SCRIPTS)) {
    assert.equal(current.scripts?.[scriptName], command, `unexpected ${scriptName}`);
    current.scripts[scriptName] = baseline.scripts[scriptName];
  }
  for (const [scriptName, command] of Object.entries(APPROVED_TEST_SCRIPTS)) {
    assert.equal(current.scripts?.[scriptName], command, `unexpected ${scriptName}`);
    delete current.scripts[scriptName];
  }
  assert.equal(current.version, APPROVED_RELEASE_METADATA.version, 'unexpected version');
  current.version = baseline.version;
  assert.equal(current.author, APPROVED_RELEASE_METADATA.author, 'unexpected author');
  current.author = baseline.author;
  assert.equal(current.build?.appId, APPROVED_RELEASE_METADATA.appId, 'unexpected build.appId');
  if (current.build && typeof current.build === 'object') current.build.appId = baseline.build.appId;

  const expectedDependencies = APPROVED_RELEASE_METADATA.devDependencies;
  assert.deepEqual(
    Object.keys(current.devDependencies || {}).sort(),
    Object.keys(expectedDependencies).sort(),
    'unexpected devDependencies',
  );
  for (const [dependency, expected] of Object.entries(expectedDependencies)) {
    const declared = current.devDependencies?.[dependency];
    assert.equal(declared, expected, `unexpected devDependency ${dependency}`);
    assert.match(declared || '', EXACT_DEPENDENCY_VERSION, `${dependency} must be exact`);
  }

  const lockPath = path.join(projectRoot, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    assert.equal(lock.version, APPROVED_RELEASE_METADATA.version, 'unexpected lockfile version');
    assert.equal(lock.packages?.['']?.version, APPROVED_RELEASE_METADATA.version, 'unexpected root lockfile version');
    for (const dependency of Object.keys(expectedDependencies)) {
      const declared = current.devDependencies?.[dependency];
      assert.equal(lock.packages?.['']?.devDependencies?.[dependency], declared);
      assert.equal(lock.packages?.[`node_modules/${dependency}`]?.version, declared);
    }
  }
  current.devDependencies = baseline.devDependencies;
  assert.ok(Array.isArray(current.build?.files), 'build.files must be an array');
  for (const approvedFile of APPROVED_RUNTIME_BUILD_FILES) {
    const matchingIndexes = current.build.files
      .map((value, index) => (value === approvedFile ? index : -1))
      .filter((index) => index >= 0);
    assert.equal(matchingIndexes.length, 1, `unexpected ${approvedFile} entry count`);
    current.build.files.splice(matchingIndexes[0], 1);
  }
  assert.deepEqual(current, baseline);
}

// Backward-compatible names used by the Phase 0 report and older probes.
export const assertPackageOnlyAddsApprovedTestScripts = assertPackageOnlyAddsApprovedReleaseChanges;
export const assertPhase0PackageOnlyAddsTestScripts = assertPackageOnlyAddsApprovedReleaseChanges;

export function assertBaselineCheckpointIntact() {
  const manifest = loadBaselineManifest();
  assert.equal(manifest.length, BASELINE_FILE_COUNT);
  assert.equal(manifest.reduce((total, row) => total + row.size, 0), BASELINE_TOTAL_BYTES);
  const manifestPaths = manifest.map((row) => row.path);
  assert.equal(new Set(manifestPaths).size, manifestPaths.length, 'baseline paths must be unique');

  const packageRow = manifest.find((row) => row.path === 'package.json');
  const packageBytes = fs.readFileSync(BASELINE_PACKAGE_PATH);
  assert.ok(packageRow);
  assert.equal(packageRow.size, packageBytes.length);
  assert.equal(packageRow.sha256, sha256Buffer(packageBytes));

  const gitDirectory = path.join(PROJECT_ROOT, '.git');
  if (!fs.existsSync(gitDirectory)) return { gitVerified: false };

  const tagResult = spawnSync('git', ['rev-parse', '--verify', `${BASELINE_TAG}^{commit}`], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  });
  assert.equal(tagResult.status, 0, tagResult.stderr);

  for (const row of manifest) {
    const result = spawnSync('git', ['show', `${BASELINE_TAG}:${row.path}`], {
      cwd: PROJECT_ROOT,
      maxBuffer: 20 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `cannot read ${row.path} from ${BASELINE_TAG}`);
    assert.equal(result.stdout.length, row.size, `baseline size changed: ${row.path}`);
    assert.equal(sha256Buffer(result.stdout), row.sha256, `baseline hash changed: ${row.path}`);
  }
  return { gitVerified: true };
}

// This now protects the immutable checkpoint, rather than requiring the current
// working tree to stay byte-identical to v2.3.4 after legitimate fixes.
export function assertBaselineSourcesUnchanged() {
  const result = assertBaselineCheckpointIntact();
  assertPackageOnlyAddsApprovedTestScripts();
  return result;
}

export function recursiveManifest(root, { excludeTopLevel = [] } = {}) {
  if (!fs.existsSync(root)) return [];
  const excluded = new Set(excludeTopLevel);
  const rows = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath);
      const topLevel = relativePath.split(path.sep)[0];
      if (excluded.has(topLevel)) continue;
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() || entry.isSymbolicLink()) {
        rows.push({
          path: relativePath.split(path.sep).join('/'),
          type: entry.isSymbolicLink() ? 'symlink' : 'file',
          sha256: entry.isFile() ? sha256File(fullPath) : null,
        });
      }
    }
  };
  walk(root);
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

export function currentProjectManifest() {
  return recursiveManifest(PROJECT_ROOT, { excludeTopLevel: PROJECT_SNAPSHOT_EXCLUDES });
}

export function copyCurrentProjectTree(destinationRoot) {
  fs.cpSync(PROJECT_ROOT, destinationRoot, {
    recursive: true,
    filter(sourcePath) {
      const relativePath = path.relative(PROJECT_ROOT, sourcePath);
      if (!relativePath) return true;
      const topLevel = relativePath.split(path.sep)[0];
      return !PROJECT_SNAPSHOT_EXCLUDES.includes(topLevel);
    },
  });
}

// Backward-compatible export for older probes. Temporary tests intentionally use
// the current production source so newly fixed behavior is actually exercised.
export const copyBaselineTree = copyCurrentProjectTree;

export async function withTemporaryProject(callback) {
  const sourceBefore = currentProjectManifest();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-mascot-phase0-'));
  const projectRoot = path.join(temporaryRoot, 'project');
  const userDataRoot = path.join(temporaryRoot, 'user-data');
  const userCharacters = path.join(userDataRoot, 'characters');
  copyCurrentProjectTree(projectRoot);
  fs.mkdirSync(userDataRoot, { recursive: true });
  fs.cpSync(path.join(projectRoot, 'characters', 'default'), userCharacters, { recursive: true });

  try {
    return await callback({ temporaryRoot, projectRoot, userDataRoot, userCharacters });
  } finally {
    const diagnosticFlushRegistry = globalThis.__phase0DiagnosticFlushRegistry;
    const diagnosticFlushers = diagnosticFlushRegistry?.get(projectRoot);
    if (diagnosticFlushers) {
      for (const flushDiagnostics of diagnosticFlushers) await flushDiagnostics();
      diagnosticFlushRegistry.delete(projectRoot);
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    assert.deepEqual(currentProjectManifest(), sourceBefore, 'temporary test changed the source tree');
    assertBaselineCheckpointIntact();
  }
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function runConfigCheck(projectRoot) {
  return spawnSync(process.execPath, ['scripts/check-config.js'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
}

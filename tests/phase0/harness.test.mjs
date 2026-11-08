import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  PROJECT_ROOT,
  assertBaselineCheckpointIntact,
  assertPackageOnlyAddsApprovedReleaseChanges,
  assertPackageOnlyAddsApprovedTestScripts,
  currentProjectManifest,
  loadBaselineManifest,
  withTemporaryProject,
} from './helpers/workspace.mjs';
import {
  loadMainForTest,
  loadRendererForTest,
  loadSettingsForTest,
} from './helpers/loaders.mjs';

const require = createRequire(import.meta.url);

test('Phase 0: the immutable v2.3.4 checkpoint remains verifiable', () => {
  const manifest = loadBaselineManifest();
  assert.equal(manifest.length, 36);
  const result = assertBaselineCheckpointIntact();
  assert.equal(result.gitVerified, fs.existsSync(path.join(PROJECT_ROOT, '.git')));
  assertPackageOnlyAddsApprovedTestScripts();
});

test('Phase 0: temporary tests cannot modify the current source tree', async () => {
  const before = currentProjectManifest();
  await withTemporaryProject(async ({ projectRoot, userCharacters }) => {
    fs.rmSync(path.join(projectRoot, 'characters', 'default'), { recursive: true, force: true });
    fs.writeFileSync(path.join(userCharacters, 'temporary-only.txt'), 'safe temporary mutation');
  });
  assert.deepEqual(currentProjectManifest(), before);
  assertBaselineCheckpointIntact();
});

test('Phase 0: main, renderer, and settings VM loaders execute production source', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const main = loadMainForTest({ projectRoot, userDataRoot });
    assert.equal(typeof main.api.validateAndNormalizeConfig, 'function');
    assert.ok(main.handlers.has('mascot:save-config'));

    const renderer = loadRendererForTest({ projectRoot });
    assert.equal(typeof renderer.api.updateMotion, 'function');
    assert.equal(typeof renderer.api.chooseWeightedAction, 'function');

    const settings = loadSettingsForTest({ projectRoot });
    assert.equal(typeof settings.api.loadConfiguration, 'function');
    assert.equal(typeof settings.api.measureVisibleContent, 'function');
  });
});

test('Phase 0: shared rule modules are pure and importable', () => {
  const rules = require(path.join(PROJECT_ROOT, 'shared', 'config-rules.js'));
  const assets = require(path.join(PROJECT_ROOT, 'shared', 'asset-validation.js'));
  assert.equal(rules.CONFIG_RULES.weight.maximum, 10);
  assert.ok(rules.ALLOWED_MOVEMENTS.includes('orthogonal'));
  assert.equal(assets.hasAllowedImageExtension('actions/rest.svg'), true);
  assert.equal(assets.hasAllowedImageExtension('actions/readme.txt'), false);
  assert.equal(assets.isLexicallyInsideRoot('/safe/root', '/safe/root/actions/a.png'), true);
  assert.equal(assets.isLexicallyInsideRoot('/safe/root', '/safe/outside.png'), false);
});

test('Phase 0: only approved release metadata and matching dependency locks are accepted', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const packagePath = path.join(projectRoot, 'package.json');
    const lockPath = path.join(projectRoot, 'package-lock.json');
    const original = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);

    assertPackageOnlyAddsApprovedReleaseChanges(projectRoot);

    const invalidChanges = [
      [(pkg) => { pkg.author = 'someone-else'; }, /unexpected author/],
      [(pkg) => { pkg.build.appId = 'com.invalid.other'; }, /unexpected build\.appId/],
      [(pkg) => { pkg.devDependencies.electron = '45.2.2'; }, /unexpected devDependency electron/],
      [(pkg) => { pkg.devDependencies.extra = '1.0.0'; }, /unexpected devDependencies/],
    ];
    for (const [mutate, error] of invalidChanges) {
      const invalid = structuredClone(original);
      mutate(invalid);
      fs.writeFileSync(packagePath, `${JSON.stringify(invalid, null, 2)}\n`);
      assert.throws(() => assertPackageOnlyAddsApprovedReleaseChanges(projectRoot), error);
    }

    fs.writeFileSync(packagePath, `${JSON.stringify(original, null, 2)}\n`);
    const validLock = {
      packages: {
        '': { devDependencies: { electron: '45.2.3', 'electron-builder': '26.18.0' } },
        'node_modules/electron': { version: '45.2.3' },
        'node_modules/electron-builder': { version: '26.18.0' },
      },
    };
    fs.writeFileSync(lockPath, `${JSON.stringify(validLock, null, 2)}\n`);
    assertPackageOnlyAddsApprovedReleaseChanges(projectRoot);

    validLock.packages['node_modules/electron'].version = '45.2.2';
    fs.writeFileSync(lockPath, `${JSON.stringify(validLock, null, 2)}\n`);
    assert.throws(() => assertPackageOnlyAddsApprovedReleaseChanges(projectRoot));
  });
});

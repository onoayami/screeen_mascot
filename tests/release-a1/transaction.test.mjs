import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { loadMainForTest } from '../phase0/helpers/loaders.mjs';
import {
  readJson,
  recursiveManifest,
  withTemporaryProject,
  writeJson,
} from '../phase0/helpers/workspace.mjs';

function isStagingTarget(target, destination) {
  return path.resolve(String(target)).startsWith(`${path.resolve(destination)}.staging-`);
}

function invokePrepare(main) {
  try {
    const projectRequire = createRequire(path.join(main.context.__dirname, 'main.js'));
    main.api.recoverDevelopmentDistributionDefaults();
    const { config, characterDirectory } = main.api.loadNormalizedConfig({ persistMigration: false });
    const result = projectRequire('./shared/distribution-defaults').replaceDirectoryTransaction({
      sourceRoot: characterDirectory,
      destinationRoot: main.api.getBundledCharacterDirectory(),
      config,
      fsModule: main.api.fsModule,
      validateAsset: main.api.validateImageDecodes,
    });
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

test('A1-01: distribution failure is structured and preserves the previous default', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const destination = path.join(projectRoot, 'characters', 'default');
    const before = recursiveManifest(destination);
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      fsOverrides: {
        cpSync(source, target, options) {
          if (path.resolve(target) === path.resolve(destination)) throw new Error('injected copy failure');
          return fs.cpSync(source, target, options);
        },
        copyFileSync(source, target, ...rest) {
          if (isStagingTarget(target, destination)) throw new Error('injected copy failure');
          return fs.copyFileSync(source, target, ...rest);
        },
      },
    });

    let result;
    await assert.doesNotReject(async () => {
      result = await invokePrepare(main);
    });
    assert.equal(result?.ok, false);
    assert.match(String(result?.error), /injected copy failure/);
    assert.deepEqual(recursiveManifest(destination), before);
  });
});

test('A1-02: distribution output contains only config-referenced assets', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const privateAsset = path.join(userCharacters, 'actions', 'private-unused.png');
    fs.writeFileSync(privateAsset, 'private test data');
    const main = loadMainForTest({ projectRoot, userDataRoot });
    const result = await invokePrepare(main);
    assert.equal(result?.ok, true);

    const destination = path.join(projectRoot, 'characters', 'default');
    assert.equal(fs.existsSync(path.join(destination, 'actions', 'private-unused.png')), false);
    assert.deepEqual(
      recursiveManifest(destination).map((row) => row.path),
      [
        'actions/fly.svg',
        'actions/rest.svg',
        'actions/sing.svg',
        'actions/walk.svg',
        'config.json',
        'effects/footprint.svg',
        'effects/note.svg',
      ],
    );
  });
});

test('A1-03: failed first installation leaves no partial character directory', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    fs.rmSync(userCharacters, { recursive: true, force: true });
    let stagedCopies = 0;
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      fsOverrides: {
        cpSync(source, target, options) {
          if (path.resolve(target) === path.resolve(userCharacters)) {
            fs.mkdirSync(target, { recursive: true });
            fs.writeFileSync(path.join(target, 'partial.txt'), 'partial');
            throw new Error('injected initial copy failure');
          }
          return fs.cpSync(source, target, options);
        },
        copyFileSync(source, target, ...rest) {
          if (isStagingTarget(target, userCharacters)) {
            stagedCopies += 1;
            if (stagedCopies === 2) throw new Error('injected initial copy failure');
          }
          return fs.copyFileSync(source, target, ...rest);
        },
      },
    });

    assert.throws(() => main.api.ensureCharacterDirectory(), /injected initial copy failure/);
    assert.equal(fs.existsSync(userCharacters), false);
    const parent = path.dirname(userCharacters);
    const leftovers = fs.existsSync(parent)
      ? fs.readdirSync(parent).filter((name) => name.startsWith('characters.staging-'))
      : [];
    assert.deepEqual(leftovers, []);
  });
});

test('A1-04: swap failure rolls the backup back into place', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const destination = path.join(projectRoot, 'characters', 'default');
    const before = recursiveManifest(destination);
    let injected = false;
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      fsOverrides: {
        renameSync(source, target) {
          if (isStagingTarget(source, destination) && path.resolve(target) === path.resolve(destination)) {
            injected = true;
            throw new Error('injected swap failure');
          }
          return fs.renameSync(source, target);
        },
      },
    });

    const result = await invokePrepare(main);
    assert.equal(injected, true);
    assert.equal(result?.ok, false);
    assert.match(String(result?.error), /injected swap failure/);
    assert.deepEqual(recursiveManifest(destination), before);
    assert.equal(fs.existsSync(`${destination}.backup`), false);
    const staging = fs.readdirSync(path.dirname(destination))
      .filter((name) => name.startsWith('default.staging-'));
    assert.deepEqual(staging, []);
  });
});

test('A1-05: startup recovery restores backup and removes stale staging', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const destination = path.join(projectRoot, 'characters', 'default');
    const backup = `${destination}.backup`;
    const staging = `${destination}.staging-interrupted`;
    const before = recursiveManifest(destination);
    fs.renameSync(destination, backup);
    fs.cpSync(backup, staging, { recursive: true });
    fs.writeFileSync(path.join(staging, 'partial.txt'), 'partial');

    const main = loadMainForTest({ projectRoot, userDataRoot });
    const result = main.api.recoverDevelopmentDistributionDefaults();
    assert.equal(result.restoredBackup, true);
    assert.equal(result.removedStagingCount, 1);
    assert.deepEqual(recursiveManifest(destination), before);
    assert.equal(fs.existsSync(backup), false);
    assert.equal(fs.existsSync(staging), false);
  });
});

test('A1-06: successful replacement retains the previous default as backup', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const destination = path.join(projectRoot, 'characters', 'default');
    const before = recursiveManifest(destination);
    const main = loadMainForTest({ projectRoot, userDataRoot });
    const result = await invokePrepare(main);
    assert.equal(result?.ok, true);
    assert.equal(result.backupRoot, `${destination}.backup`);
    assert.deepEqual(recursiveManifest(result.backupRoot), before);
    assert.deepEqual(result.includedFiles, recursiveManifest(destination).map((row) => row.path));
  });
});

test('A1-07: a referenced image with a mismatched signature is rejected safely', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const destination = path.join(projectRoot, 'characters', 'default');
    const before = recursiveManifest(destination);
    const configPath = path.join(userCharacters, 'config.json');
    const config = readJson(configPath);
    config.actions[0].file = 'actions/not-an-image.png';
    fs.writeFileSync(path.join(userCharacters, 'actions', 'not-an-image.png'), 'not a PNG');
    writeJson(configPath, config);

    const main = loadMainForTest({ projectRoot, userDataRoot });
    const result = await invokePrepare(main);
    assert.equal(result?.ok, false);
    assert.match(String(result?.error), /画像形式と内容が一致しません/);
    assert.deepEqual(recursiveManifest(destination), before);
  });
});

test('A1-08: a referenced symbolic link is rejected safely', async () => {
  await withTemporaryProject(async ({ temporaryRoot, projectRoot, userDataRoot, userCharacters }) => {
    const destination = path.join(projectRoot, 'characters', 'default');
    const before = recursiveManifest(destination);
    const outside = path.join(temporaryRoot, 'outside.png');
    const linkedAsset = path.join(userCharacters, 'actions', 'linked.png');
    fs.writeFileSync(outside, 'outside data');
    fs.symlinkSync(outside, linkedAsset);
    const configPath = path.join(userCharacters, 'config.json');
    const config = readJson(configPath);
    config.actions[0].file = 'actions/linked.png';
    writeJson(configPath, config);

    const main = loadMainForTest({ projectRoot, userDataRoot });
    const result = await invokePrepare(main);
    assert.equal(result?.ok, false);
    assert.match(String(result?.error), /シンボリックリンク|通常ファイルではありません|実体が素材フォルダの外/);
    assert.deepEqual(recursiveManifest(destination), before);
  });
});


test('A1-09: window load rejection is reported without an unhandled rejection', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const errors = [];
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      dialogOverrides: {
        showErrorBox(title, message) { errors.push({ title, message }); },
      },
    });
    const result = await main.api.loadWindowFileWithRecovery(
      { loadFile: () => Promise.reject(new Error('injected load failure')) },
      'index.html',
      'マスコット画面',
    );
    assert.equal(result, false);
    assert.equal(errors.length, 1);
    assert.match(errors[0].title, /マスコット画面を開けませんでした/);
    assert.match(errors[0].message, /injected load failure/);
    assert.match(errors[0].message, /画像・設定フォルダ/);
  });
});

test('A1-10: startup initialization failure is reported and quits safely', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const errors = [];
    let quitCalled = false;
    loadMainForTest({
      projectRoot,
      userDataRoot,
      appOverrides: {
        whenReady: () => Promise.resolve(),
        quit() { quitCalled = true; },
      },
      dialogOverrides: {
        showErrorBox(title, message) { errors.push({ title, message }); },
      },
      fsOverrides: {
        readdirSync(target, options) {
          if (path.resolve(target) === path.resolve(path.join(projectRoot, 'characters'))) {
            throw new Error('injected startup failure');
          }
          return fs.readdirSync(target, options);
        },
      },
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(quitCalled, true);
    assert.equal(errors.length, 1);
    assert.match(errors[0].title, /マスコットを起動できませんでした/);
    assert.match(errors[0].message, /injected startup failure/);
    assert.match(errors[0].message, /既存データは自動削除していません/);
  });
});

test('A1-11: every runtime shared module is included in the packaged app', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const packageJson = readJson(path.join(projectRoot, 'package.json'));
    const buildFiles = packageJson.build.files;
    assert.equal(buildFiles.filter((value) => value === 'shared/**/*').length, 1);
    assert.equal(buildFiles.includes('characters/default/**/*'), true);
    assert.equal(buildFiles.includes('characters/**/*'), false);
    for (const relativePath of [
      'shared/distribution-defaults.js',
      'shared/asset-validation.js',
      'shared/config-rules.js',
      'shared/concurrency.js',
      'shared/image-decode.js',
    ]) {
      assert.equal(fs.existsSync(path.join(projectRoot, relativePath)), true, relativePath);
      assert.equal(buildFiles.includes('shared/**/*'), true, `${relativePath} is not packaged`);
    }
  });
});

test('A1-12: atomic asset migration keeps the original image extension', async () => {
  await withTemporaryProject(async ({ temporaryRoot, projectRoot }) => {
    const projectRequire = createRequire(path.join(projectRoot, 'main.js'));
    const { replaceFileAtomically } = projectRequire('./shared/distribution-defaults');
    const sourceFile = path.join(temporaryRoot, 'source.svg');
    const destinationFile = path.join(temporaryRoot, 'destination.svg');
    fs.writeFileSync(sourceFile, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>');
    fs.writeFileSync(destinationFile, '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>');
    let validatedTemporaryFile = '';

    replaceFileAtomically({
      sourceFile,
      destinationFile,
      relativePath: 'effects/destination.svg',
      fsModule: fs,
      randomId: () => 'extension',
      validateAsset(filePath) {
        validatedTemporaryFile = filePath;
        assert.equal(path.extname(filePath), '.svg');
      },
    });

    assert.equal(path.extname(validatedTemporaryFile), '.svg');
    assert.equal(fs.readFileSync(destinationFile, 'utf8'), fs.readFileSync(sourceFile, 'utf8'));
    assert.equal(fs.existsSync(`${destinationFile}.migrate-backup`), false);
  });
});

test('A1-13: atomic asset migration restores the old file after swap failure', async () => {
  await withTemporaryProject(async ({ temporaryRoot, projectRoot }) => {
    const projectRequire = createRequire(path.join(projectRoot, 'main.js'));
    const { replaceFileAtomically } = projectRequire('./shared/distribution-defaults');
    const sourceFile = path.join(temporaryRoot, 'source.svg');
    const destinationFile = path.join(temporaryRoot, 'destination.svg');
    const oldContent = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
    fs.writeFileSync(sourceFile, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>');
    fs.writeFileSync(destinationFile, oldContent);
    const wrappedFs = new Proxy(fs, {
      get(target, property) {
        if (property === 'renameSync') {
          return (source, targetPath) => {
            if (
              path.resolve(targetPath) === path.resolve(destinationFile)
              && path.basename(source).startsWith('.destination.migrate-')
            ) {
              throw new Error('injected migration swap failure');
            }
            return fs.renameSync(source, targetPath);
          };
        }
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    assert.throws(
      () => replaceFileAtomically({
        sourceFile,
        destinationFile,
        relativePath: 'effects/destination.svg',
        fsModule: wrappedFs,
        randomId: () => 'rollback',
      }),
      /injected migration swap failure/,
    );
    assert.equal(fs.readFileSync(destinationFile, 'utf8'), oldContent);
    assert.equal(fs.existsSync(`${destinationFile}.migrate-backup`), false);
    assert.deepEqual(
      fs.readdirSync(temporaryRoot).filter((name) => name.includes('.migrate-')),
      [],
    );
  });
});


test('A1-14: post-copy hash mismatch is rejected while preserving the old default', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const destination = path.join(projectRoot, 'characters', 'default');
    const before = recursiveManifest(destination);
    let corrupted = false;
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      fsOverrides: {
        copyFileSync(source, target, ...rest) {
          const result = fs.copyFileSync(source, target, ...rest);
          if (!corrupted && isStagingTarget(target, destination)) {
            fs.appendFileSync(target, '\ncorrupted after copy');
            corrupted = true;
          }
          return result;
        },
      },
    });

    const result = await invokePrepare(main);
    assert.equal(corrupted, true);
    assert.equal(result?.ok, false);
    assert.match(String(result?.error), /ハッシュが一致しません/);
    assert.deepEqual(recursiveManifest(destination), before);
    assert.equal(fs.existsSync(`${destination}.backup`), false);
  });
});

test('A1-15: rollback failure preserves backup for next-start recovery', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const destination = path.join(projectRoot, 'characters', 'default');
    const backup = `${destination}.backup`;
    const before = recursiveManifest(destination);
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      fsOverrides: {
        renameSync(source, target) {
          if (path.resolve(target) === path.resolve(destination)) {
            if (isStagingTarget(source, destination)) throw new Error('injected swap failure');
            if (path.resolve(source) === path.resolve(backup)) throw new Error('injected rollback failure');
          }
          return fs.renameSync(source, target);
        },
      },
    });

    const result = await invokePrepare(main);
    assert.equal(result?.ok, false);
    assert.match(String(result?.error), /backupを保護しています/);
    assert.equal(fs.existsSync(destination), false);
    assert.deepEqual(recursiveManifest(backup), before);
    assert.deepEqual(
      fs.readdirSync(path.dirname(destination)).filter((name) => name.startsWith('default.staging-')),
      [],
    );

    const recoveringMain = loadMainForTest({ projectRoot, userDataRoot });
    const recovery = recoveringMain.api.recoverDevelopmentDistributionDefaults();
    assert.equal(recovery.restoredBackup, true);
    assert.deepEqual(recursiveManifest(destination), before);
    assert.equal(fs.existsSync(backup), false);
  });
});

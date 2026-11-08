import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { loadMainForTest, loadSettingsForTest } from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

function projectRequire(projectRoot) {
  return createRequire(path.join(projectRoot, 'package.json'));
}

function basicConfig(name = 'Hardening') {
  return {
    name,
    mascot: { size: 180, startPosition: 'bottom-right', margin: 40, rememberPosition: true },
    actions: [{
      name: '休む',
      file: 'actions/rest.svg',
      weight: 1,
      durationMs: [5000, 9000],
      movement: { type: 'still', speed: 0 },
    }],
  };
}

test('character directory preparation is reused but its symlink safety check remains active', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    let fileReads = 0;
    let rootLstatCalls = 0;
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      appOverrides: { isPackaged: true },
      fsOverrides: {
        openSync(filePath, ...args) {
          fileReads += 1;
          return fs.openSync(filePath, ...args);
        },
        readFileSync(filePath, ...args) {
          fileReads += 1;
          return fs.readFileSync(filePath, ...args);
        },
        lstatSync(filePath, ...args) {
          if (path.resolve(String(filePath)) === path.resolve(userCharacters)) rootLstatCalls += 1;
          return fs.lstatSync(filePath, ...args);
        },
      },
    });

    assert.equal(main.api.ensureCharacterDirectory(), userCharacters);
    fileReads = 0;
    rootLstatCalls = 0;
    assert.equal(main.api.ensureCharacterDirectory(), userCharacters);
    assert.equal(fileReads, 0);
    assert.ok(rootLstatCalls > 0);

    const movedDirectory = path.join(userDataRoot, 'characters.original');
    fs.renameSync(userCharacters, movedDirectory);
    fs.symlinkSync(movedDirectory, userCharacters, 'dir');
    try {
      assert.throws(() => main.api.ensureCharacterDirectory(), /シンボリックリンク/);
    } finally {
      fs.unlinkSync(userCharacters);
      fs.renameSync(movedDirectory, userCharacters);
    }
  });
});

test('startup removes only matching config temporary files and preserves other character files', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const firstRun = loadMainForTest({
      projectRoot,
      userDataRoot,
      appOverrides: { isPackaged: true },
    });
    firstRun.api.ensureCharacterDirectory();
    firstRun.api.loadNormalizedConfig();

    const configPath = path.join(userCharacters, 'config.json');
    const backupPath = path.join(userCharacters, 'config.backup.json');
    const configBefore = fs.readFileSync(configPath);
    const backupBefore = fs.readFileSync(backupPath);
    const imagePath = path.join(userCharacters, 'actions', 'rest.svg');
    const imageBefore = fs.readFileSync(imagePath);
    const staleFiles = [
      `config.json.${process.pid}.${randomUUID()}.tmp`,
      `config.backup.json.${process.pid}.${randomUUID()}.tmp`,
    ];
    const preservedFiles = [
      'config.json.tmp',
      'config.json.123.not-a-uuid.tmp',
      `config.json.123.${randomUUID()}.tmp.extra`,
      'config.recovery-123.json',
      'unrelated.tmp',
    ];
    for (const name of [...staleFiles, ...preservedFiles]) {
      fs.writeFileSync(path.join(userCharacters, name), name);
    }

    const symbolicTemporary = `config.json.${process.pid}.${randomUUID()}.tmp`;
    fs.symlinkSync('config.json', path.join(userCharacters, symbolicTemporary));

    const restarted = loadMainForTest({
      projectRoot,
      userDataRoot,
      appOverrides: { isPackaged: true },
    });
    assert.equal(restarted.api.ensureCharacterDirectory(), userCharacters);

    for (const name of staleFiles) assert.equal(fs.existsSync(path.join(userCharacters, name)), false);
    for (const name of preservedFiles) assert.equal(fs.existsSync(path.join(userCharacters, name)), true);
    assert.equal(fs.lstatSync(path.join(userCharacters, symbolicTemporary)).isSymbolicLink(), true);
    assert.deepEqual(fs.readFileSync(configPath), configBefore);
    assert.deepEqual(fs.readFileSync(backupPath), backupBefore);
    assert.deepEqual(fs.readFileSync(imagePath), imageBefore);
  });
});

test('temporary-file cleanup failures warn and do not stop character-directory preparation', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const firstRun = loadMainForTest({
      projectRoot,
      userDataRoot,
      appOverrides: { isPackaged: true },
    });
    firstRun.api.ensureCharacterDirectory();
    firstRun.api.loadNormalizedConfig();
    const staleName = `config.json.${process.pid}.${randomUUID()}.tmp`;
    const stalePath = path.join(userCharacters, staleName);
    fs.writeFileSync(stalePath, 'partial write');
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);

    try {
      const restarted = loadMainForTest({
        projectRoot,
        userDataRoot,
        appOverrides: { isPackaged: true },
        fsOverrides: {
          unlinkSync(filePath, ...args) {
            if (path.basename(String(filePath)) === staleName) throw new Error('injected cleanup failure');
            return fs.unlinkSync(filePath, ...args);
          },
        },
      });
      assert.equal(restarted.api.ensureCharacterDirectory(), userCharacters);
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(fs.existsSync(stalePath), true);
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /設定の一時ファイルを削除できませんでした/);
  });
});

test('toggleVisibility safely ignores a destroyed mascot window', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const main = loadMainForTest({ projectRoot, userDataRoot });
    main.api.setMascotWindow({
      isDestroyed: () => true,
      isVisible() { throw new Error('destroyed window must not be queried'); },
    });

    assert.equal(main.api.toggleVisibility(), false);
  });
});

test('image signatures read only a 64 KB head except for GIF', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const validation = projectRequire(projectRoot)('./shared/asset-validation.js');
    const probes = path.join(projectRoot, 'signature-probes');
    fs.mkdirSync(probes);
    const readSizes = [];
    const fullReads = [];
    const fsModule = {
      ...fs,
      openSync(...args) { return fs.openSync(...args); },
      readSync(fd, buffer, offset, length, position) {
        const bytesRead = fs.readSync(fd, buffer, offset, length, position);
        readSizes.push(bytesRead);
        return bytesRead;
      },
      closeSync(...args) { return fs.closeSync(...args); },
      readFileSync(filePath, ...args) {
        fullReads.push(path.basename(String(filePath)));
        return fs.readFileSync(filePath, ...args);
      },
    };
    const payloadSize = 64 * 1024 + 128;
    const probesToCheck = [
      ['large.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(payloadSize)])],
      ['large.jpg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(payloadSize)])],
      ['large.webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(payloadSize)])],
      ['large.svg', Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"></svg>${' '.repeat(payloadSize)}`)],
    ];

    for (const [name, content] of probesToCheck) {
      const filePath = path.join(probes, name);
      fs.writeFileSync(filePath, content);
      assert.equal(validation.validateImageSignature(filePath, filePath, fsModule), true);
    }

    assert.equal(fullReads.length, 0);
    assert.equal(readSizes.length, probesToCheck.length);
    assert.ok(readSizes.every((bytesRead) => bytesRead <= 64 * 1024));

    const gifPath = path.join(probes, 'small.gif');
    fs.writeFileSync(gifPath, Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
    ]));
    assert.equal(validation.validateImageSignature(gifPath, gifPath, fsModule), true);
    assert.deepEqual(fullReads, ['small.gif']);
  });
});

test('transparent PNG size is rejected before Buffer copying and normal PNGs still save', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const main = loadMainForTest({ projectRoot, userDataRoot });
    let copyCalls = 0;
    main.context.Buffer = new Proxy(Buffer, {
      get(target, property) {
        if (property === 'from') {
          return (...args) => {
            copyCalls += 1;
            return Buffer.from(...args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const { MAX_IMAGE_FILE_BYTES } = projectRequire(projectRoot)('./shared/asset-validation.js');
    const oversized = vm.runInContext(`new ArrayBuffer(${MAX_IMAGE_FILE_BYTES + 1})`, main.context);
    main.context.oversizedInput = oversized;
    const oversizedView = vm.runInContext('new Uint8Array(oversizedInput)', main.context);
    for (const input of [oversized, oversizedView]) {
      assert.throws(
        () => main.api.saveTransparentPng(input, 'actions', 'too-large.png'),
        /20MB以下/,
      );
    }
    assert.equal(copyCalls, 0);

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const saved = main.api.saveTransparentPng(png, 'actions', 'converted.png');
    assert.equal(copyCalls, 1);
    assert.equal(fs.existsSync(path.join(userCharacters, saved.relativePath)), true);
  });
});

test('settings configuration loading resolves image assets with concurrency capped at four', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    let active = 0;
    let maximumActive = 0;
    const config = basicConfig();
    config.actions = Array.from({ length: 10 }, (_, index) => ({
      ...config.actions[0],
      name: `動作${index + 1}`,
      file: `actions/action-${index}.svg`,
    }));
    const settings = loadSettingsForTest({
      projectRoot,
      mascotAPI: {
        loadConfig: async () => ({ config }),
        resolveAsset: async (relativePath) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return `file://${relativePath}`;
        },
      },
    });

    await settings.api.loadConfiguration();
    assert.equal(settings.api.state.actions.length, 10);
    assert.equal(maximumActive, 4);
  });
});

test('JSON writes use unique fsynced temporary files and preserve the prior config on fsync failure', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const temporaryPaths = [];
    const operations = [];
    let failNextFsync = false;
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      appOverrides: { isPackaged: true },
      fsOverrides: {
        openSync(filePath, ...args) {
          if (/config\.json\.\d+\..+\.tmp$/.test(path.basename(String(filePath)))) {
            temporaryPaths.push(String(filePath));
            operations.push('open');
          }
          return fs.openSync(filePath, ...args);
        },
        fsyncSync(descriptor) {
          operations.push('fsync');
          if (failNextFsync) {
            failNextFsync = false;
            throw new Error('injected fsync failure');
          }
          return fs.fsyncSync(descriptor);
        },
        closeSync(descriptor) {
          operations.push('close');
          return fs.closeSync(descriptor);
        },
        renameSync(source, destination) {
          operations.push('rename');
          return fs.renameSync(source, destination);
        },
      },
    });
    main.api.ensureCharacterDirectory();
    const config = main.api.loadNormalizedConfig().config;
    temporaryPaths.length = 0;
    operations.length = 0;

    main.api.writeConfigAtomic({ ...config, name: 'Atomic one' }, { backupCurrent: false });
    main.api.writeConfigAtomic({ ...config, name: 'Atomic two' }, { backupCurrent: false });
    assert.equal(temporaryPaths.length, 2);
    assert.notEqual(temporaryPaths[0], temporaryPaths[1]);
    assert.deepEqual(operations, ['open', 'fsync', 'close', 'rename', 'open', 'fsync', 'close', 'rename']);
    assert.equal(fs.readFileSync(path.join(userCharacters, 'config.json'), 'utf8').includes('Atomic two'), true);

    const configPath = path.join(userCharacters, 'config.json');
    const previousConfig = fs.readFileSync(configPath);
    const renameCount = operations.filter((operation) => operation === 'rename').length;
    failNextFsync = true;
    assert.throws(
      () => main.api.writeConfigAtomic({ ...config, name: 'Atomic failure' }, { backupCurrent: false }),
      /injected fsync failure/,
    );
    assert.deepEqual(fs.readFileSync(configPath), previousConfig);
    assert.equal(operations.filter((operation) => operation === 'rename').length, renameCount);
    assert.equal(fs.readdirSync(userCharacters).some((name) => /^config\.json\.\d+\..+\.tmp$/.test(name)), false);
  });
});

test('IPC error prefixes are removed from user-visible settings errors', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({
      projectRoot,
      mascotAPI: {
        loadConfig: async () => {
          throw new Error("Error invoking remote method 'mascot:load-config': Error: 設定ファイルを読み込めません");
        },
      },
    });

    await settings.api.loadConfiguration();
    assert.equal(
      settings.api.elements.feedback.textContent,
      '設定を読み込めませんでした：設定ファイルを読み込めません',
    );
    assert.doesNotMatch(settings.api.elements.feedback.textContent, /Error invoking remote method/);
  });
});

test('configuration recovery keeps only the five newest recovery snapshots', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      appOverrides: { isPackaged: true },
    });
    main.api.ensureCharacterDirectory();
    const backupPath = path.join(userCharacters, 'config.backup.json');
    fs.writeFileSync(backupPath, fs.readFileSync(path.join(userCharacters, 'config.json')));
    for (let timestamp = 1000; timestamp < 1007; timestamp += 1) {
      fs.writeFileSync(path.join(userCharacters, `config.recovery-${timestamp}.json`), `snapshot-${timestamp}`);
    }

    const recovered = main.api.recoverEditableConfig('defaults');
    const recoveryFiles = fs.readdirSync(userCharacters)
      .filter((name) => /^config\.recovery-\d+\.json$/.test(name))
      .sort((left, right) => Number(left.match(/recovery-(\d+)/)[1]) - Number(right.match(/recovery-(\d+)/)[1]));

    assert.equal(recovered.ok, true);
    assert.equal(recoveryFiles.length, 5);
    assert.ok(recoveryFiles.includes(path.basename(recovered.recoveryPath)));
    assert.deepEqual(
      recoveryFiles,
      [
        'config.recovery-1003.json',
        'config.recovery-1004.json',
        'config.recovery-1005.json',
        'config.recovery-1006.json',
        path.basename(recovered.recoveryPath),
      ].sort((left, right) => Number(left.match(/recovery-(\d+)/)[1]) - Number(right.match(/recovery-(\d+)/)[1])),
    );
    assert.equal(fs.existsSync(backupPath), true);
    assert.equal(fs.existsSync(path.join(userCharacters, 'actions', 'rest.svg')), true);
  });
});

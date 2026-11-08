import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  runConfigCheck,
  withTemporaryProject,
  writeJson,
} from '../phase0/helpers/workspace.mjs';

const require = createRequire(import.meta.url);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, '../..');

function validConfig(overrides = {}) {
  return {
    name: 'test mascot',
    mascot: {
      size: 180,
      startPosition: 'center',
      margin: 40,
      rememberPosition: true,
      ...(overrides.mascot || {}),
    },
    actions: overrides.actions || [{
      name: 'rest',
      file: 'actions/rest.svg',
      weight: 1,
      durationMs: [5000, 9000],
      flipMode: 'direction',
      imageTransform: { scale: 1, offsetX: 0, offsetY: 0 },
      movement: { type: 'still', speed: 0 },
    }],
  };
}

function commonValidator() {
  const rulesPath = path.join(projectRoot, 'shared', 'config-rules.js');
  delete require.cache[require.resolve(rulesPath)];
  return require(rulesPath).validateAndNormalizeConfig;
}

function combinedOutput(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('A3-01: the shared validator reports null root and null action shapes', () => {
  const validate = commonValidator();
  assert.equal(typeof validate, 'function');
  assert.throws(() => validate(null), /設定/);
  assert.throws(() => validate({ actions: [null] }), /actions\[0\]/);
});

test('A3-02: the shared validator rejects provided values outside the common ranges', () => {
  const validate = commonValidator();
  const options = { validateAsset: () => {} };
  assert.throws(
    () => validate(validConfig({ mascot: { size: -1 } }), options),
    /mascot\.size/,
  );
  assert.throws(
    () => validate(validConfig({ actions: [{
      ...validConfig().actions[0],
      durationMs: [-1000, -2000],
    }] }), options),
    /actions\[0\]\.durationMs/,
  );
  assert.throws(
    () => validate(validConfig({ actions: [{
      ...validConfig().actions[0],
      movement: { type: 'horizontal', speed: -99 },
    }] }), options),
    /actions\[0\]\.movement\.speed/,
  );
});

test('A3-03: the build check rejects invalid ranges and a directory asset', async () => {
  await withTemporaryProject(async ({ projectRoot: temporaryProject }) => {
    writeJson(path.join(temporaryProject, 'characters', 'default', 'config.json'), {
      name: 'invalid',
      mascot: { size: -1, margin: -1 },
      actions: [{
        name: 'invalid action',
        file: 'actions',
        weight: 1,
        durationMs: [-1000, -2000],
        movement: { type: 'horizontal', speed: -99 },
      }],
    });
    const result = runConfigCheck(temporaryProject);
    assert.notEqual(result.status, 0, combinedOutput(result));
    assert.match(combinedOutput(result), /mascot\.size|durationMs|movement\.speed|通常ファイル/);
  });
});

test('A3-04: the build check reports null shapes without a TypeError stack', async () => {
  await withTemporaryProject(async ({ projectRoot: temporaryProject }) => {
    const configPath = path.join(temporaryProject, 'characters', 'default', 'config.json');
    for (const [value, expected] of [
      [{ actions: [null] }, /actions\[0\]/],
      [null, /設定|config\.json/],
    ]) {
      writeJson(configPath, value);
      const result = runConfigCheck(temporaryProject);
      const output = combinedOutput(result);
      assert.notEqual(result.status, 0);
      assert.match(output, expected);
      assert.doesNotMatch(output, /TypeError/);
    }
  });
});

test('A3-05: runtime and build-time validation use the shared validator', () => {
  const mainSource = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
  const checkSource = fs.readFileSync(path.join(projectRoot, 'scripts', 'check-config.js'), 'utf8');
  assert.match(mainSource, /require\(['"]\.\/shared\/config-rules['"]\)/);
  assert.doesNotMatch(mainSource, /function validateAndNormalizeConfig\s*\(/);
  assert.match(checkSource, /require\(['"]\.\.\/shared\/config-rules['"]\)/);
  assert.match(checkSource, /validateAndNormalizeConfig/);
});

test('A3-06: tracked instructions contain neither U+FFFD nor the stale folder name', () => {
  const candidates = [
    path.join(projectRoot, 'README.md'),
    path.join(projectRoot, 'START_HERE.txt'),
    ...fs.readdirSync(path.join(projectRoot, 'docs'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => path.join(projectRoot, 'docs', name)),
  ];
  for (const filePath of candidates) {
    const text = fs.readFileSync(filePath, 'utf8');
    assert.equal(text.includes('\uFFFD'), false, filePath);
    assert.equal(text.includes('desktop-mascot-starter'), false, filePath);
  }
});

test('A3-07: the release-text checker reports replacement characters with file names', () => {
  const checkerPath = path.join(projectRoot, 'scripts', 'check-release-text.js');
  const checker = require(checkerPath);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mascot-a3-text-'));
  try {
    fs.writeFileSync(path.join(temporaryRoot, 'broken.md'), '壊れた\uFFFD本文\n', 'utf8');
    const errors = checker.scanReleaseText(temporaryRoot);
    assert.ok(errors.some((error) => error.includes('broken.md') && error.includes('U+FFFD')));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('A3-08: the source ZIP is deterministic and marks Japanese names as UTF-8', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mascot-a3-zip-'));
  try {
    const source = path.join(temporaryRoot, 'source');
    fs.mkdirSync(path.join(source, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(source, 'characters', 'default', 'actions'), { recursive: true });
    fs.writeFileSync(path.join(source, 'README.md'), 'read me\n', 'utf8');
    fs.writeFileSync(path.join(source, 'docs', '01_最短.md'), '説明\n', 'utf8');
    fs.writeFileSync(path.join(source, '.DS_Store'), 'excluded', 'utf8');
    fs.writeFileSync(path.join(source, '.env'), 'PRIVATE_TOKEN=do-not-package\n', 'utf8');
    fs.writeFileSync(path.join(source, 'private-local.txt'), 'private\n', 'utf8');
    fs.writeFileSync(path.join(source, 'characters', 'default', 'actions', 'rest.svg'), '<svg/>\n');
    fs.writeFileSync(path.join(source, 'characters', 'default', 'actions', 'unused-private.svg'), '<svg/>\n');
    fs.writeFileSync(
      path.join(source, 'characters', 'default', 'config.json'),
      `${JSON.stringify({ actions: [{ name: 'rest', file: 'actions/rest.svg' }] }, null, 2)}\n`,
      'utf8',
    );
    const script = path.join(projectRoot, 'scripts', 'create-source-zip.py');
    const outputs = [path.join(temporaryRoot, 'one.zip'), path.join(temporaryRoot, 'two.zip')];
    for (const output of outputs) {
      const result = spawnSync('python3', [
        script,
        '--root', source,
        '--output', output,
        '--prefix', 'desktop-mascot',
      ], { encoding: 'utf8' });
      assert.equal(result.status, 0, combinedOutput(result));
    }
    assert.equal(sha256(outputs[0]), sha256(outputs[1]));
    const inspect = spawnSync('python3', ['-c', [
      'import json,sys,zipfile',
      'with zipfile.ZipFile(sys.argv[1]) as z:',
      ' print(json.dumps([{"name": i.filename, "flags": i.flag_bits} for i in z.infolist()]))',
    ].join('\n'), outputs[0]], { encoding: 'utf8' });
    assert.equal(inspect.status, 0, combinedOutput(inspect));
    const entries = JSON.parse(inspect.stdout);
    assert.deepEqual(entries.map((entry) => entry.name), [
      'desktop-mascot/README.md',
      'desktop-mascot/characters/default/actions/rest.svg',
      'desktop-mascot/characters/default/config.json',
      'desktop-mascot/docs/01_最短.md',
    ]);
    assert.ok(entries.find((entry) => entry.name.includes('最短')).flags & 0x800);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('A3-11: source ZIP rejects untracked Git files and ignores standard exclusions', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mascot-a3-untracked-'));
  try {
    const source = path.join(temporaryRoot, 'source');
    const characters = path.join(source, 'characters', 'default');
    const actions = path.join(characters, 'actions');
    fs.mkdirSync(actions, { recursive: true });
    const initialized = spawnSync('git', ['init', '--quiet', source], { encoding: 'utf8' });
    assert.equal(initialized.status, 0, combinedOutput(initialized));

    const gitExclude = path.join(source, '.git', 'info', 'exclude');
    fs.writeFileSync(
      gitExclude,
      'characters/default/config.json\ncharacters/default/actions/rest.svg\nignored-local.txt\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(characters, 'config.json'),
      `${JSON.stringify({ actions: [{ name: 'rest', file: 'actions/rest.svg' }] })}\n`,
      'utf8',
    );
    fs.writeFileSync(path.join(actions, 'rest.svg'), '<svg/>\n', 'utf8');
    fs.writeFileSync(path.join(source, 'ignored-local.txt'), 'ignored\n', 'utf8');
    const untrackedPath = path.join(source, 'new-source.js');
    fs.writeFileSync(untrackedPath, 'export const value = true;\n', 'utf8');

    const script = path.join(projectRoot, 'scripts', 'create-source-zip.py');
    const outputs = [path.join(temporaryRoot, 'one.zip'), path.join(temporaryRoot, 'two.zip')];
    const runZip = (output) => spawnSync('python3', [
      script,
      '--root', source,
      '--output', output,
      '--prefix', 'desktop-mascot',
    ], { encoding: 'utf8' });

    const rejected = runZip(outputs[0]);
    assert.notEqual(rejected.status, 0);
    assert.match(combinedOutput(rejected), /new-source\.js/);
    assert.doesNotMatch(combinedOutput(rejected), /ignored-local\.txt/);
    assert.equal(fs.existsSync(outputs[0]), false);

    fs.unlinkSync(untrackedPath);
    for (const output of outputs) {
      const result = runZip(output);
      assert.equal(result.status, 0, combinedOutput(result));
    }
    assert.equal(sha256(outputs[0]), sha256(outputs[1]));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('A3-09: package metadata pins Mac-verified dependency and tool versions', {
  todo: 'Electron／electron-builderの版、Node、最低macOSはMac実機確認後に確定する。',
}, () => {});

test('A3-10: the source ZIP names match on macOS and Windows extractors', {
  todo: 'macOS標準解凍とWindows実機で同じ日本語名を確認する。',
}, () => {});

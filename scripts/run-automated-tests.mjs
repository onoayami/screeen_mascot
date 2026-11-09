import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyCurrentProjectTree, PROJECT_ROOT } from '../tests/phase0/helpers/workspace.mjs';

const BASELINE_REF = 'v2.3.4-baseline^{commit}';

function baselineTagStatus(
  projectRoot,
  run = spawnSync,
  gitDirectoryExists = (root) => fs.existsSync(path.join(root, '.git')),
) {
  if (!gitDirectoryExists(projectRoot)) return 'unavailable';
  const result = run('git', ['rev-parse', '--verify', '--quiet', BASELINE_REF], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'ignore',
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`git rev-parse が ${result.signal} で終了しました。`);
  if (result.status === 0) return 'present';
  if (result.status === 1) return 'missing';
  throw new Error(`git rev-parse が予期しない状態で終了しました：${result.status}`);
}

function runAutomatedSuite(projectRoot, {
  run = spawnSync,
  env = process.env,
} = {}) {
  const result = run('npm', ['run', 'test:automated'], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.signal) {
    const signalNumber = os.constants.signals[result.signal] || 1;
    return 128 + signalNumber;
  }
  return result.status ?? 1;
}

export function runAutomatedTests({
  projectRoot = PROJECT_ROOT,
  run = spawnSync,
  copyTree = copyCurrentProjectTree,
  makeTempDirectory = (prefix) => fs.mkdtempSync(prefix),
  createChildTempDirectory = (directory) => fs.mkdirSync(directory, { recursive: true }),
  removeTree = (target) => fs.rmSync(target, { recursive: true, force: true }),
  gitDirectoryExists = (root) => fs.existsSync(path.join(root, '.git')),
  env = process.env,
} = {}) {
  const tagStatus = baselineTagStatus(projectRoot, run, gitDirectoryExists);
  if (tagStatus !== 'missing') return runAutomatedSuite(projectRoot, { run, env });

  console.warn(
    `[test:automated:local] ${BASELINE_REF} が見つからないため、fixture整合性検証を維持して .git を除く専用コピーで実行します。Git履歴検証は実行できません。`,
  );
  const snapshotRoot = makeTempDirectory(path.join(os.tmpdir(), 'desktop-mascot-tests-'));
  const snapshotProject = path.join(snapshotRoot, 'project');
  const childTempDirectory = path.join(snapshotRoot, 'runtime-tmp');
  try {
    copyTree(snapshotProject);
    createChildTempDirectory(childTempDirectory);
    return runAutomatedSuite(snapshotProject, {
      run,
      env: { ...env, TMPDIR: childTempDirectory, TEMP: childTempDirectory, TMP: childTempDirectory },
    });
  } finally {
    removeTree(snapshotRoot);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  try {
    process.exitCode = runAutomatedTests();
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  }
}

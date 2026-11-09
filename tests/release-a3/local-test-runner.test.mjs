import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT_ROOT } from '../phase0/helpers/workspace.mjs';
import { runAutomatedTests } from '../../scripts/run-automated-tests.mjs';

test('local test runner uses an isolated snapshot and always removes it when the baseline tag is missing', () => {
  const calls = [];
  const result = runAutomatedTests({
    projectRoot: PROJECT_ROOT,
    env: { PATH: 'test-path' },
    gitDirectoryExists: () => true,
    run(command, args, options) {
      calls.push({ command, args, options });
      return { status: command === 'git' ? 1 : 7 };
    },
    makeTempDirectory(prefix) {
      assert.match(prefix, /desktop-mascot-tests-/);
      return '/controlled/test-root';
    },
    copyTree(snapshotProject) {
      assert.equal(snapshotProject, '/controlled/test-root/project');
      calls.push({ action: 'copyTree' });
    },
    createChildTempDirectory(directory) {
      assert.equal(directory, '/controlled/test-root/runtime-tmp');
      calls.push({ action: 'createChildTempDirectory' });
    },
    removeTree(directory) {
      calls.push({ action: 'removeTree', directory });
    },
  });

  assert.equal(result, 7);
  const git = calls.find((call) => call.command === 'git');
  assert.deepEqual(git.args, ['rev-parse', '--verify', '--quiet', 'v2.3.4-baseline^{commit}']);
  assert.equal(git.options.cwd, PROJECT_ROOT);
  assert.equal(calls.filter((call) => call.command === 'git').length, 1);
  assert.equal(calls.filter((call) => call.action === 'removeTree').length, 1);
  assert.equal(calls.find((call) => call.action === 'removeTree').directory, '/controlled/test-root');
  const suite = calls.find((call) => call.command === 'npm');
  assert.deepEqual(suite.args, ['run', 'test:automated']);
  assert.equal(suite.options.cwd, '/controlled/test-root/project');
  assert.equal(suite.options.env.TMPDIR, '/controlled/test-root/runtime-tmp');
});

test('local test runner propagates unexpected Git termination without creating a snapshot', () => {
  let snapshotCreated = false;
  assert.throws(() => runAutomatedTests({
    projectRoot: PROJECT_ROOT,
    gitDirectoryExists: () => true,
    run(command) {
      assert.equal(command, 'git');
      return { status: 128 };
    },
    makeTempDirectory() {
      snapshotCreated = true;
      return '/controlled/test-root';
    },
  }), /予期しない状態/);
  assert.equal(snapshotCreated, false);
});

test('local test runner cleans up its owned snapshot when copying fails', () => {
  let cleanedPath = null;
  assert.throws(() => runAutomatedTests({
    projectRoot: PROJECT_ROOT,
    gitDirectoryExists: () => true,
    run(command) {
      assert.equal(command, 'git');
      return { status: 1 };
    },
    makeTempDirectory: () => '/controlled/test-root',
    copyTree: () => { throw new Error('copy failed'); },
    removeTree: (directory) => { cleanedPath = directory; },
  }), /copy failed/);
  assert.equal(cleanedPath, '/controlled/test-root');
});

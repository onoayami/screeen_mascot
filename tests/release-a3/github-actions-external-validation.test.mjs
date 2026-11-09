import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, '../..');
const workflowPath = path.join(projectRoot, '.github', 'workflows', 'external-os-validation.yml');

function workflowSource() {
  assert.ok(fs.existsSync(workflowPath), 'external OS validation workflow is missing');
  return fs.readFileSync(workflowPath, 'utf8');
}

test('A3-18: GitHub Actions covers deterministic source packaging and native OS extraction', () => {
  const source = workflowSource();
  assert.match(source, /workflow_dispatch\s*:/);
  assert.match(source, /runs-on:\s*ubuntu-latest/);
  assert.match(source, /runs-on:\s*windows-latest/);
  assert.match(source, /runs-on:\s*macos-latest/);
  assert.match(source, /create-source-zip\.py/);
  assert.match(source, /sha256/i);
  assert.match(source, /Expand-Archive/);
  assert.match(source, /A3-Windows解凍確認\.ps1/);
  assert.match(
    source,
    /& \(Join-Path \$Root 'A3-Windows解凍確認\.ps1'\) -ResultPath/,
  );
  assert.match(source, /ditto\s+-x\s+-k/);
  assert.match(source, /inspect-a3-extraction\.mjs/);
  assert.match(source, /actions\/upload-artifact@v4/);
  assert.match(source, /actions\/download-artifact@v4/);
});

test('A3-19: fixed dependencies are validated by default and latest is opt-in', () => {
  const source = workflowSource();
  assert.match(source, /npm run check:build-lock/);
  assert.match(source, /npm ci/);
  assert.match(source, /electron-latest-compatibility:/);
  assert.match(source, /inputs\.electron_latest_compat == true/);
  assert.match(source, /continue-on-error:\s*true/);
  assert.match(source, /npm install[^\n]*--package-lock-only[^\n]*--ignore-scripts[^\n]*--save-exact[^\n]*electron@latest[^\n]*electron-builder@latest/);
  assert.match(source, /node -p "require\('\.\/package\.json'\)\.version"/);
  assert.match(source, /SOURCE_ARCHIVE=desktop-mascot-ui-v\$\{version\}-external-validation\.zip/);
  assert.match(source, /SOURCE_ROOT=desktop-mascot-ui-v\$\{version\}/);
  assert.match(source, /check:build-lock/);
  assert.match(source, /test:automated/);
  assert.match(source, /playwright install chromium/);
  assert.match(source, /CHROMIUM_PATH/);
  assert.match(source, /CSC_IDENTITY_AUTO_DISCOVERY=false/);
  assert.match(source, /build:mac:universal/);
  assert.match(source, /hdiutil verify/);

  const fixedMacJob = source.split('  macos-native-extraction-and-build:')[1]?.split(
    '  electron-latest-compatibility:',
  )[0];
  const optionalLatestJob = source.split('  electron-latest-compatibility:')[1];
  assert.ok(fixedMacJob, 'fixed macOS validation job is missing');
  assert.ok(optionalLatestJob, 'optional latest compatibility job is missing');
  const macArtifactStep = fixedMacJob.indexOf('- name: Upload macOS evidence and unsigned artifacts');
  const fixedBuildStep = fixedMacJob.indexOf('env CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac:universal');
  assert.ok(macArtifactStep > fixedBuildStep, 'macOS evidence upload must follow the fixed build');
  assert.match(fixedMacJob.slice(macArtifactStep), /name:\s*macos-validation-evidence/);
  assert.match(fixedMacJob.slice(macArtifactStep), /macos-validation/);
  assert.match(fixedMacJob.slice(macArtifactStep), /macos-candidate\/dist/);
  assert.doesNotMatch(optionalLatestJob, /Upload macOS evidence and unsigned artifacts/);

  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  for (const name of ['test:release-b', 'test:release-c', 'test:release-d', 'test:automated']) {
    assert.equal(typeof packageJson.scripts?.[name], 'string', `${name} is missing`);
  }
  for (const command of [
    'test:phase0:harness',
    'test:phase0:known-defects',
    'test:release-a1',
    'test:release-a2',
    'test:release-a3',
    'test:release-b',
    'test:release-c',
    'test:release-d',
  ]) {
    assert.ok(packageJson.scripts['test:automated'].includes(command), command);
  }
});

test('A3-20: external validation workflow is read-only and preserves manual-only boundaries', () => {
  const source = workflowSource();
  assert.match(source, /permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(source, /contents:\s*write/);
  assert.doesNotMatch(source, /pull_request_target\s*:/);
  assert.match(source, /Developer ID|Gatekeeper|notar/i);
  assert.match(source, /manual|手動/i);

  const windowsSource = fs.readFileSync(
    path.join(projectRoot, 'A3-Windows解凍確認.ps1'),
    'utf8',
  );
  assert.match(windowsSource, /\[string\]\$ResultPath/);
  assert.match(windowsSource, /ResultPath/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { loadMainForTest, loadSettingsForTest } from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

function movingAction(overrides = {}) {
  return {
    _uiId: 'moving-action',
    name: '歩く',
    file: 'actions/walk.svg',
    _assetUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
    weight: 1,
    durationMs: [6000, 10000],
    flipMode: 'direction',
    imageTransform: { flipX: true, scale: 1, offsetX: 0, offsetY: 0 },
    movement: { type: 'horizontal', speed: 55 },
    ...overrides,
  };
}

function makeAnimationScheduler() {
  let nextId = 0;
  const pending = new Map();
  const cancelled = [];
  return {
    pending,
    cancelled,
    requestAnimationFrame(callback) {
      nextId += 1;
      pending.set(nextId, callback);
      return nextId;
    },
    cancelAnimationFrame(id) {
      cancelled.push(id);
      pending.delete(id);
    },
    frame(timestamp) {
      const entry = pending.entries().next().value;
      assert.ok(entry, 'a frame should be pending');
      const [id, callback] = entry;
      pending.delete(id);
      callback(timestamp);
    },
  };
}

test('shared speed rules enforce a strict maximum of 300 and only load-correct legacy values', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const require = createRequire(path.join(projectRoot, 'package.json'));
    const rules = require('./shared/config-rules.js');
    const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'characters/default/config.json'), 'utf8'));
    const html = fs.readFileSync(path.join(projectRoot, 'settings.html'), 'utf8');
    config.actions[1].movement.speed = 300;
    assert.equal(rules.CONFIG_RULES.movementSpeed.maximum, 300);
    assert.match(html.match(/<input id="movement-speed"[^>]*>/)?.[0] || '', /max="300"/);
    assert.equal(rules.validateAndNormalizeConfig(config).actions[1].movement.speed, 300);

    for (const speed of [301, 2000, -1, Number.NaN]) {
      const candidate = structuredClone(config);
      candidate.actions[1].movement.speed = speed;
      if (speed >= 301 && speed <= 2000) {
        assert.throws(() => rules.validateAndNormalizeConfig(candidate), /0〜300/);
        const loaded = rules.validateAndNormalizeLoadedConfig(candidate);
        assert.equal(loaded.config.actions[1].movement.speed, 300);
        assert.equal(loaded.warnings.length, 1);
        assert.equal(candidate.actions[1].movement.speed, speed);
      } else {
        assert.throws(() => rules.validateAndNormalizeLoadedConfig(candidate), /0〜300/);
      }
    }

    const tooHigh = structuredClone(config);
    tooHigh.actions[1].movement.speed = 2001;
    assert.throws(() => rules.validateAndNormalizeLoadedConfig(tooHigh), /0〜300/);
  });
});

test('legacy saved speeds are capped for loading with a warning and without changing config or creating a backup', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const main = loadMainForTest({ projectRoot, userDataRoot });
    const configPath = path.join(userCharacters, 'config.json');
    const backupPath = path.join(userCharacters, 'config.backup.json');
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    raw.actions[1].movement.speed = 2000;
    const savedBytes = `${JSON.stringify(raw, null, 2)}\n`;
    fs.writeFileSync(configPath, savedBytes);

    const editable = main.api.loadEditableConfig();
    assert.equal(editable.config.actions[1].movement.speed, 300);
    assert.match(editable.warnings[0], /旧速さ設定を上限300/);
    assert.match(editable.warnings[0], /元の設定ファイルは変更していません/);
    assert.deepEqual(Array.from(editable.pendingMigrations), ['legacy-movement-speed']);

    const runtime = main.api.loadNormalizedConfig();
    assert.equal(runtime.config.actions[1].movement.speed, 300);
    assert.equal(runtime.warnings.length, 1);
    assert.equal(fs.readFileSync(configPath, 'utf8'), savedBytes);
    assert.equal(fs.existsSync(backupPath), false);

    const strict = JSON.parse(savedBytes);
    strict.actions[1].movement.speed = 301;
    assert.throws(() => main.api.validateAndNormalizeConfig(strict), /0〜300/);
  });
});

test('explicit backup recovery warns when legacy speeds are capped and writes the normalized config', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot, userCharacters }) => {
    const main = loadMainForTest({ projectRoot, userDataRoot });
    const backupPath = path.join(userCharacters, 'config.backup.json');
    const backup = JSON.parse(fs.readFileSync(path.join(userCharacters, 'config.json'), 'utf8'));
    backup.actions[1].movement.speed = 2000;
    fs.writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`);

    const recovered = main.api.recoverEditableConfig('backup');

    assert.equal(recovered.config.actions[1].movement.speed, 300);
    assert.match(recovered.warnings[0], /旧速さ設定を上限300/);
    assert.deepEqual(Array.from(recovered.pendingMigrations), []);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(userCharacters, 'config.json'), 'utf8')).actions[1].movement.speed,
      300,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(backupPath, 'utf8')).actions[1].movement.speed,
      300,
    );
    assert.equal(fs.existsSync(recovered.recoveryPath), true);
  });
});

test('settings recovery toast discloses when restoring a legacy speed was normalized', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'characters/default/config.json'), 'utf8'));
    const settings = loadSettingsForTest({
      projectRoot,
      mascotAPI: {
        recoverConfig: async () => ({
          ok: true,
          warnings: ['「歩く」の旧速さ設定を上限300として読み込みました。'],
        }),
        loadConfig: async () => ({
          config,
          warnings: [],
          pendingMigrations: [],
          recovery: { kind: 'none', canRestoreBackup: false },
        }),
      },
    });

    assert.equal(await settings.api.recoverConfiguration('backup'), true);
    assert.match(settings.api.elements.toast.textContent, /旧速さ設定を300にして復元/);
  });
});

test('legacy load enables explicit full save and successful persistence clears the migration state', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'characters/default/config.json'), 'utf8'));
    config.actions[1].movement.speed = 300;
    config.actions[2].movement.speed = 90;
    const savedPayloads = [];
    const settings = loadSettingsForTest({
      projectRoot,
      mascotAPI: {
        loadConfig: async () => ({
          config,
          warnings: ['旧速さ設定を上限300として読み込みました。全体保存または選択中の動作の保存時に、全動作の旧速さが300で更新されます。'],
          pendingMigrations: ['legacy-movement-speed'],
          recovery: { kind: 'none', canRestoreBackup: false },
        }),
        saveConfig: async (payload) => {
          savedPayloads.push(payload);
          return { ok: true, applied: true, config: payload };
        },
      },
    });

    await settings.api.loadConfiguration();

    assert.equal(settings.api.state.migrationPending, true);
    assert.equal(settings.api.state.dirty, true);
    assert.equal(settings.api.elements.headerSaveButton.disabled, false);
    assert.equal(settings.api.elements.saveButton.disabled, false);
    assert.match(settings.api.elements.feedback.textContent, /旧速さ設定が300で更新/);

    assert.equal(await settings.api.saveConfiguration(), true);
    assert.equal(savedPayloads.length, 1);
    assert.ok(savedPayloads[0].actions.every((action) => action.movement.speed <= 300));
    assert.equal(settings.api.state.migrationPending, false);
    assert.equal(settings.api.state.dirty, false);
    assert.equal(settings.api.elements.headerSaveButton.disabled, true);
    assert.equal(settings.api.elements.saveButton.disabled, true);
    assert.equal(settings.api.elements.recoveryPanel.hidden, true);
  });
});

test('selected-action save includes normalized speeds for every legacy action and discloses migration', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'characters/default/config.json'), 'utf8'));
    config.actions[1].movement.speed = 300;
    config.actions[2].movement.speed = 90;
    const savedPayloads = [];
    const settings = loadSettingsForTest({
      projectRoot,
      mascotAPI: {
        loadConfig: async () => ({
          config,
          warnings: ['旧速さ設定を上限300として読み込みました。全体保存または選択中の動作の保存時に、全動作の旧速さが300で更新されます。'],
          pendingMigrations: ['legacy-movement-speed'],
          recovery: { kind: 'none', canRestoreBackup: false },
        }),
        saveConfig: async (payload) => {
          savedPayloads.push(payload);
          return { ok: true, applied: true, config: payload };
        },
      },
    });
    await settings.api.loadConfiguration();
    assert.match(settings.api.elements.feedback.textContent, /選択中の動作を保存すると/);
    settings.api.state.selectedId = settings.api.state.actions[1]._uiId;
    settings.api.renderEditor();
    settings.api.elements.actionName.value = '編集した歩く';
    settings.api.elements.actionName.dispatchEvent({ type: 'input' });

    assert.match(settings.api.elements.recoveryMessage.textContent, /全動作の旧速さが300で更新/);
    assert.equal(await settings.api.saveSelectedAction(), true);
    assert.equal(savedPayloads.length, 1);
    assert.ok(savedPayloads[0].actions.every((action) => action.movement.speed <= 300));
    assert.equal(savedPayloads[0].actions[1].name, '編集した歩く');
    assert.equal(settings.api.state.migrationPending, false);
    assert.equal(settings.api.state.dirty, false);
    assert.equal(settings.api.elements.recoveryPanel.hidden, true);
  });
});

test('failed save keeps legacy migration pending and retries against the unchanged normalized baseline', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'characters/default/config.json'), 'utf8'));
    const payloads = [];
    let shouldFail = true;
    const settings = loadSettingsForTest({
      projectRoot,
      mascotAPI: {
        loadConfig: async () => ({
          config,
          warnings: ['旧速さ設定を上限300として読み込みました。'],
          pendingMigrations: ['legacy-movement-speed'],
          recovery: { kind: 'none', canRestoreBackup: false },
        }),
        saveConfig: async (payload) => {
          payloads.push(payload);
          if (shouldFail) return { ok: false };
          return { ok: true, applied: true, config: payload };
        },
      },
    });
    await settings.api.loadConfiguration();
    const baselineBeforeSave = JSON.stringify(settings.api.state.persistedSnapshot);
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.equal(await settings.api.saveConfiguration(), false);
    } finally {
      console.error = originalError;
    }

    assert.equal(settings.api.state.migrationPending, true);
    assert.equal(settings.api.state.dirty, true);
    assert.equal(JSON.stringify(settings.api.state.persistedSnapshot), baselineBeforeSave);
    assert.equal(settings.api.elements.headerSaveButton.disabled, false);
    assert.equal(settings.api.elements.recoveryPanel.hidden, false);

    shouldFail = false;
    assert.equal(await settings.api.saveConfiguration(), true);
    assert.equal(payloads.length, 2);
    assert.equal(settings.api.state.migrationPending, false);
    assert.equal(settings.api.state.dirty, false);
    assert.equal(settings.api.elements.recoveryPanel.hidden, true);
  });
});

test('speed preview uses capped frame deltas, reflects at edges, and honors the image base flip', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const scheduler = makeAnimationScheduler();
    const settings = loadSettingsForTest({
      projectRoot,
      requestAnimationFrame: scheduler.requestAnimationFrame,
      cancelAnimationFrame: scheduler.cancelAnimationFrame,
    });
    const action = movingAction();
    settings.api.state.actions = [action];
    settings.api.state.selectedId = action._uiId;
    assert.equal(scheduler.pending.size, 0, 'loading an action must not start a preview');
    settings.api.elements.movementSpeed.value = '300';
    settings.api.elements.movementSpeed.dispatchEvent({ type: 'input' });

    assert.equal(settings.api.movementPreviewState().running, true);
    assert.equal(settings.api.elements.movementSpeedPreviewImage.hidden, false);
    assert.match(settings.api.elements.movementSpeedPreviewImage.style.transform, /scaleX\(-1\)/);
    assert.equal(scheduler.pending.size, 1);
    scheduler.frame(0);
    for (let frame = 1; frame <= 6; frame += 1) scheduler.frame(frame * 50);

    assert.equal(settings.api.movementPreviewState().position, 90);
    assert.equal(settings.api.elements.movementSpeedPreviewImage.style.left, '98px');
    assert.equal(scheduler.pending.size, 1);

    const bounceScheduler = makeAnimationScheduler();
    const bounceSettings = loadSettingsForTest({
      projectRoot,
      requestAnimationFrame: bounceScheduler.requestAnimationFrame,
      cancelAnimationFrame: bounceScheduler.cancelAnimationFrame,
    });
    bounceSettings.api.state.actions = [movingAction()];
    bounceSettings.api.state.selectedId = 'moving-action';
    bounceSettings.api.elements.movementSpeed.value = '300';
    bounceSettings.api.elements.movementSpeed.dispatchEvent({ type: 'input' });
    bounceScheduler.frame(0);
    for (let frame = 1; frame <= 23; frame += 1) bounceScheduler.frame(frame * 50);
    assert.equal(bounceSettings.api.movementPreviewState().direction, -1);
    assert.equal(bounceSettings.api.elements.movementSpeedPreviewImage.style.transform.includes('scaleX(-1)'), false);
  });
});

test('preview scheduling is singular and cleanup covers manual stop, selection changes, still actions, hidden page, and dialogs', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const scheduler = makeAnimationScheduler();
    const settings = loadSettingsForTest({
      projectRoot,
      requestAnimationFrame: scheduler.requestAnimationFrame,
      cancelAnimationFrame: scheduler.cancelAnimationFrame,
    });
    const action = movingAction();
    const other = movingAction({ _uiId: 'other-action', movement: { type: 'still', speed: 0 } });
    settings.api.state.actions = [action, other];
    settings.api.state.selectedId = action._uiId;
    const speed = settings.api.elements.movementSpeed;
    speed.value = '80';
    speed.dispatchEvent({ type: 'input' });
    speed.value = '90';
    speed.dispatchEvent({ type: 'input' });
    assert.equal(scheduler.pending.size, 1);
    const revisionBeforeStop = settings.api.state.revision;
    const speedBeforeStop = action.movement.speed;

    settings.api.elements.movementSpeedPreviewStop.dispatchEvent({ type: 'click' });
    assert.equal(settings.api.movementPreviewState().running, false);
    assert.equal(settings.api.movementPreviewState().frame, null);
    assert.equal(scheduler.pending.size, 0);
    assert.ok(scheduler.cancelled.length > 0);
    assert.equal(settings.api.state.revision, revisionBeforeStop);
    assert.equal(action.movement.speed, speedBeforeStop);

    speed.dispatchEvent({ type: 'input' });
    settings.api.state.selectedId = other._uiId;
    settings.api.renderEditor();
    assert.equal(settings.api.movementPreviewState().running, false);

    settings.api.state.selectedId = action._uiId;
    speed.dispatchEvent({ type: 'input' });
    settings.context.document.hidden = true;
    settings.context.document.dispatchEvent({ type: 'visibilitychange' });
    assert.equal(settings.api.movementPreviewState().running, false);
    settings.context.document.hidden = false;

    speed.dispatchEvent({ type: 'input' });
    speed.value = '90';
    settings.api.elements.movementType.value = 'still';
    settings.api.elements.movementType.dispatchEvent({ type: 'change' });
    assert.equal(settings.api.movementPreviewState().running, false);

    action.movement.type = 'horizontal';
    settings.api.elements.movementType.value = 'horizontal';
    speed.dispatchEvent({ type: 'input' });
    await settings.api.importImage('actions');
    assert.equal(settings.api.movementPreviewState().running, false);

    speed.dispatchEvent({ type: 'input' });
    settings.window.dispatch('pagehide');
    assert.equal(settings.api.movementPreviewState().running, false);

    speed.dispatchEvent({ type: 'input' });
    settings.api.elements.openDurationBulk.dispatchEvent({ type: 'click' });
    assert.equal(settings.api.movementPreviewState().running, false);
    assert.equal(settings.api.elements.durationBulkDialog.open, true);
    settings.api.elements.durationBulkCancel.dispatchEvent({ type: 'click' });

    speed.dispatchEvent({ type: 'input' });
    settings.api.elements.deleteAction.dispatchEvent({ type: 'click' });
    assert.equal(settings.api.movementPreviewState().running, false);
    assert.equal(settings.api.state.actions.some((candidate) => candidate._uiId === action._uiId), false);
  });
});

test('preview reports a stage with no travel space without scheduling animation', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const scheduler = makeAnimationScheduler();
    const settings = loadSettingsForTest({
      projectRoot,
      requestAnimationFrame: scheduler.requestAnimationFrame,
      cancelAnimationFrame: scheduler.cancelAnimationFrame,
    });
    const action = movingAction();
    settings.api.state.actions = [action];
    settings.api.state.selectedId = action._uiId;
    settings.api.elements.movementSpeedPreviewStage.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 90, height: 112, right: 90, bottom: 112,
    });
    settings.api.elements.movementSpeed.value = '55';
    settings.api.elements.movementSpeed.dispatchEvent({ type: 'input' });

    assert.equal(scheduler.pending.size, 0);
    assert.equal(settings.api.movementPreviewState().running, false);
    assert.match(settings.api.elements.movementSpeedPreviewNote.textContent, /移動できる幅がありません/);
  });
});

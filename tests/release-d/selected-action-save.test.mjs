import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadSettingsForTest } from '../phase0/helpers/loaders.mjs';
import { PROJECT_ROOT } from '../phase0/helpers/workspace.mjs';

class LoadingImage {
  constructor() {
    this.naturalWidth = 100;
    this.naturalHeight = 100;
  }

  set src(value) {
    this._src = value;
    queueMicrotask(() => this.onload?.());
  }

  get src() {
    return this._src;
  }
}

function configWithActions(count = 2) {
  return {
    name: 'テストマスコット',
    mascot: { size: 180, startPosition: 'bottom-right', margin: 40, rememberPosition: true },
    actions: Array.from({ length: count }, (_, index) => ({
      name: `動作${index + 1}`,
      file: `actions/action-${index + 1}.png`,
      weight: index + 1,
      durationMs: [6000 + index * 1000, 10000 + index * 1000],
      flipMode: 'direction',
      imageTransform: { flipX: false, scale: 1, offsetX: 0, offsetY: 0 },
      movement: { type: 'still', speed: 0 },
    })),
  };
}

async function createSettings(config = configWithActions(), apiOverrides = {}) {
  const settings = loadSettingsForTest({
    projectRoot: PROJECT_ROOT,
    ImageClass: LoadingImage,
    mascotAPI: {
      loadConfig: async () => ({ config: structuredClone(config) }),
      ...apiOverrides,
    },
  });
  await settings.api.loadConfiguration();
  return settings;
}

test('selected save persists all selected settings without including other pending edits', async () => {
  const initial = configWithActions();
  const payloads = [];
  const settings = await createSettings(initial, {
    saveConfig: async (config, previewIndex) => {
      payloads.push({ config: structuredClone(config), previewIndex });
      return { ok: true, applied: true, config };
    },
  });
  const [selected, other] = settings.api.state.actions;

  Object.assign(selected, {
    name: '歩く',
    weight: 7,
    durationMs: [12000, 18000],
    flipMode: 'random',
    imageTransform: { flipX: true, scale: 1.4, offsetX: 5, offsetY: -3 },
    movement: { type: 'horizontal', speed: 90 },
    effect: {
      file: 'effects/steps.png',
      intervalMs: 300,
      size: 42,
      lifetimeMs: 1500,
      offsetX: -4,
      offsetY: 15,
      coordinateVersion: 2,
      emitWhileStill: false,
    },
  });
  settings.api.state.config.mascot.size = Number.NaN;
  other.weight = Number.NaN;
  settings.api.markDirty();

  assert.equal(await settings.api.saveSelectedAction(), true);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].previewIndex, 0);
  const payload = payloads[0].config;
  assert.equal(payload.mascot.size, initial.mascot.size);
  assert.equal(payload.actions[0].name, '歩く');
  assert.equal(payload.actions[0].weight, 7);
  assert.deepEqual(payload.actions[0].durationMs, [12000, 18000]);
  assert.equal(payload.actions[0].flipMode, 'random');
  assert.deepEqual(payload.actions[0].imageTransform, { flipX: true, scale: 1.4, offsetX: 5, offsetY: -3 });
  assert.deepEqual(payload.actions[0].movement, { type: 'horizontal', speed: 90 });
  assert.equal(payload.actions[0].effect.file, 'effects/steps.png');
  assert.equal(payload.actions[1].weight, initial.actions[1].weight);
  assert.equal(settings.api.state.dirty, true);
  assert.equal(settings.api.elements.saveButton.disabled, false);
});

test('selected save retains baseline order and deleted actions until global save', async () => {
  const initial = configWithActions(3);
  initial.actions[0].name = '同じ名前';
  initial.actions[0].file = 'actions/duplicate.png';
  initial.actions[2].name = '同じ名前';
  initial.actions[2].file = 'actions/duplicate.png';
  let savedPayload;
  let previewIndex;
  const settings = await createSettings(initial, {
    saveConfig: async (config, index) => {
      savedPayload = structuredClone(config);
      previewIndex = index;
      return { ok: true, applied: true, config };
    },
  });
  const [first, deleted, selected] = settings.api.state.actions;
  settings.api.state.actions = [selected, first];
  settings.api.state.selectedId = selected._uiId;
  selected.name = '編集した三番目';
  settings.api.markDirty();

  assert.equal(await settings.api.saveSelectedAction(), true);
  assert.deepEqual(savedPayload.actions.map((action) => action.name), [
    '同じ名前',
    '動作2',
    '編集した三番目',
  ]);
  assert.equal(previewIndex, 2);
  assert.equal(settings.api.state.actions.length, 2);
  assert.equal(settings.api.state.actions[0]._uiId, selected._uiId);
  assert.notEqual(settings.api.state.actions.some((action) => action._uiId === deleted._uiId), true);
  assert.equal(settings.api.state.dirty, true);
});

test('saving a new selected action inserts only that action after its nearest saved predecessor', async () => {
  const payloads = [];
  const settings = await createSettings(configWithActions(), {
    saveConfig: async (config, index) => {
      payloads.push({ config: structuredClone(config), index });
      return { ok: true, applied: true, config };
    },
  });

  settings.api.addAction();
  const firstNewAction = settings.api.state.actions.at(-1);
  firstNewAction.file = 'actions/new-one.png';
  settings.api.addAction();
  const selectedNewAction = settings.api.state.actions.at(-1);
  selectedNewAction.file = 'actions/new-two.png';
  selectedNewAction.name = '新しい二番目';
  settings.api.markDirty();

  assert.equal(await settings.api.saveSelectedAction(), true);
  assert.deepEqual(payloads[0].config.actions.map((action) => action.name), [
    '動作1',
    '動作2',
    '新しい二番目',
  ]);
  assert.equal(payloads[0].index, 2);
  assert.equal(settings.api.state.actions.some((action) => action._uiId === firstNewAction._uiId), true);
  assert.equal(settings.api.state.dirty, true);
});

test('a new action cannot overwrite the maximum-size saved list before global deletion is saved', async () => {
  let saveCalls = 0;
  const settings = await createSettings(configWithActions(100), {
    saveConfig: async (config) => {
      saveCalls += 1;
      return { ok: true, applied: true, config };
    },
  });
  settings.api.state.actions.shift();
  settings.api.addAction();
  const selected = settings.api.state.actions.at(-1);
  selected.file = 'actions/new.png';
  settings.api.markDirty();

  assert.equal(await settings.api.saveSelectedAction(), false);
  assert.equal(saveCalls, 0);
  assert.match(settings.api.elements.feedback.textContent, /先に下部の「保存して反映」/);
});

test('selected validation rejects the target action but ignores invalid unrelated fields', async () => {
  let saveCalls = 0;
  const settings = await createSettings(configWithActions(), {
    saveConfig: async (config) => {
      saveCalls += 1;
      return { ok: true, applied: true, config };
    },
  });
  const [selected, other] = settings.api.state.actions;
  settings.api.state.config.mascot.size = Number.NaN;
  other.weight = Number.NaN;
  selected.weight = 11;
  settings.api.markDirty();

  assert.equal(await settings.api.saveSelectedAction(), false);
  assert.equal(saveCalls, 0);
  assert.equal(settings.api.state.dirty, true);
  selected.weight = 3;
  settings.api.markDirty();
  assert.equal(await settings.api.saveSelectedAction(), true);
  assert.equal(saveCalls, 1);
});

test('failed save keeps the baseline; unapplied save remains retryable', async () => {
  const results = [
    { ok: false },
    { ok: true, applied: false, applyError: '反映未確認' },
    { ok: true, applied: true },
  ];
  let saveCalls = 0;
  const settings = await createSettings(configWithActions(), {
    saveConfig: async (config) => {
      saveCalls += 1;
      return { ...results.shift(), config };
    },
  });
  settings.api.state.actions[0].name = '新しい名前';
  settings.api.markDirty();

  assert.equal(await settings.api.saveSelectedAction(), false);
  assert.equal(settings.api.state.persistedSnapshot.config.actions[0].name, '動作1');
  assert.equal(settings.api.elements.saveSelectedAction.disabled, false);
  assert.equal(await settings.api.saveSelectedAction(), false);
  assert.equal(settings.api.state.persistedSnapshot.config.actions[0].name, '新しい名前');
  assert.equal(settings.api.state.applyRetry, true);
  assert.equal(settings.api.elements.saveSelectedAction.disabled, false);
  assert.match(settings.api.elements.toast.textContent, /「新しい名前」の反映を確認できませんでした/);
  assert.equal(await settings.api.saveSelectedAction(), true);
  assert.equal(settings.api.state.applyRetry, false);
  assert.equal(settings.api.state.dirty, false);
  assert.equal(saveCalls, 3);
});

test('full save advances the baseline before later selected saves', async () => {
  const payloads = [];
  const settings = await createSettings(configWithActions(), {
    saveConfig: async (config, index) => {
      payloads.push({ config: structuredClone(config), index });
      return { ok: true, applied: true, config };
    },
  });
  settings.api.state.config.mascot.size = 260;
  settings.api.state.actions[0].name = '全体保存した動作';
  settings.api.markDirty();
  assert.equal(await settings.api.saveConfiguration(), true);

  settings.api.state.selectedId = settings.api.state.actions[1]._uiId;
  settings.api.state.actions[1].name = '個別保存した動作';
  settings.api.markDirty();
  assert.equal(await settings.api.saveSelectedAction(), true);
  assert.equal(payloads[1].config.mascot.size, 260);
  assert.equal(payloads[1].config.actions[0].name, '全体保存した動作');
  assert.equal(payloads[1].config.actions[1].name, '個別保存した動作');
});

test('recovery reloads the baseline used by subsequent selected saves', async () => {
  let loadedConfig = configWithActions();
  const payloads = [];
  const settings = await createSettings(loadedConfig, {
    loadConfig: async () => ({ config: structuredClone(loadedConfig) }),
    recoverConfig: async () => {
      loadedConfig = configWithActions();
      loadedConfig.mascot.size = 320;
      loadedConfig.actions[0].name = '復旧した動作';
      return { ok: true };
    },
    saveConfig: async (config) => {
      payloads.push(structuredClone(config));
      return { ok: true, applied: true, config };
    },
  });
  assert.equal(await settings.api.recoverConfiguration('backup'), true);
  settings.api.state.selectedId = settings.api.state.actions[1]._uiId;
  settings.api.state.actions[1].name = '復旧後の個別編集';
  settings.api.markDirty();

  assert.equal(await settings.api.saveSelectedAction(), true);
  assert.equal(payloads[0].mascot.size, 320);
  assert.equal(payloads[0].actions[0].name, '復旧した動作');
});

test('a concurrent full save records the request snapshot without overwriting newer edits', async () => {
  let resolveSave;
  let sentPayload;
  const settings = await createSettings(configWithActions(), {
    saveConfig: (config) => {
      sentPayload = structuredClone(config);
      return new Promise((resolve) => { resolveSave = resolve; });
    },
  });
  settings.api.state.config.mascot.size = 240;
  settings.api.state.actions[0].name = '保存開始時の名前';
  settings.api.markDirty();
  const saving = settings.api.saveConfiguration();
  settings.api.state.actions[1].name = '保存中の新しい編集';
  settings.api.markDirty();
  resolveSave({ ok: true, applied: true, config: sentPayload });

  assert.equal(await saving, false);
  assert.equal(settings.api.state.persistedSnapshot.config.mascot.size, 240);
  assert.equal(settings.api.state.persistedSnapshot.config.actions[0].name, '保存開始時の名前');
  assert.equal(settings.api.state.actions[1].name, '保存中の新しい編集');
  assert.equal(settings.api.state.dirty, true);
});

test('a concurrent selected save keeps later edits pending and retryable', async () => {
  let resolveSave;
  let sentPayload;
  let calls = 0;
  const settings = await createSettings(configWithActions(), {
    saveConfig: (config) => {
      calls += 1;
      sentPayload = structuredClone(config);
      return calls === 1
        ? new Promise((resolve) => { resolveSave = resolve; })
        : Promise.resolve({ ok: true, applied: true, config });
    },
  });
  settings.api.state.actions[0].name = '送信した名前';
  settings.api.markDirty();
  const saving = settings.api.saveSelectedAction();
  assert.equal(settings.api.state.busy, true);
  assert.equal(settings.api.elements.saveSelectedAction.disabled, true);
  settings.api.state.actions[0].name = '保存中の新しい名前';
  settings.api.markDirty();
  resolveSave({ ok: true, applied: true, config: sentPayload });

  assert.equal(await saving, true);
  assert.equal(settings.api.state.persistedSnapshot.config.actions[0].name, '送信した名前');
  assert.equal(settings.api.state.actions[0].name, '保存中の新しい名前');
  assert.equal(settings.api.state.dirty, true);
  assert.equal(settings.api.elements.saveSelectedAction.disabled, false);
  assert.match(settings.api.elements.toast.textContent, /「送信した名前」を保存して反映しました/);
  assert.doesNotMatch(settings.api.elements.toast.textContent, /保存中の新しい名前/);
  assert.equal(await settings.api.saveSelectedAction(), true);
  assert.equal(settings.api.state.persistedSnapshot.config.actions[0].name, '保存中の新しい名前');
});

test('bulk save establishes a baseline that later selected saves preserve', async () => {
  const payloads = [];
  const settings = await createSettings(configWithActions(), {
    saveConfig: async (config) => {
      payloads.push(structuredClone(config));
      return { ok: true, applied: true, config };
    },
  });
  settings.api.elements.openDurationBulk.dispatchEvent({ type: 'click' });
  settings.api.elements.durationBulkMin.value = '4';
  settings.api.elements.durationBulkMax.value = '8';
  assert.equal(await settings.api.applyDurationBulk(), true);
  settings.api.state.actions[0].name = '後から個別編集';
  settings.api.markDirty();

  assert.equal(await settings.api.saveSelectedAction(), true);
  assert.deepEqual(payloads[1].actions.map((action) => action.durationMs), [[4000, 8000], [4000, 8000]]);
  assert.equal(payloads[1].actions[0].name, '後から個別編集');
});

test('selected-save control is adjacent to delete and its label and trim font match the editor', () => {
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'settings.html'), 'utf8');
  const styles = fs.readFileSync(path.join(PROJECT_ROOT, 'settings.css'), 'utf8');
  assert.match(html, /class="editor-save-actions">\s*<button id="delete-action"[^>]*>削除<\/button>\s*<button id="save-selected-action"[^>]*>保存<\/button>\s*<\/div>/);
  assert.match(styles, /\.editor-tools\s*\{\s*display:\s*flex;\s*flex-wrap:\s*wrap;/);
  assert.match(styles, /\.editor-save-actions\s*\{\s*display:\s*flex;\s*flex:\s*0 0 auto;\s*gap:\s*8px;\s*\}/);
  assert.match(html, /頻度（選ばれやすさ）/);
  assert.match(styles, /\.image-edit-button\s*\{[^}]*font-size:\s*13px/);
  assert.match(styles, /\.field(?:,\s*\.image-flip-control)?\s*\{[^}]*font-size:\s*13px/);
});

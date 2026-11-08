import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSettingsForTest } from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

function config() {
  return {
    name: '入力検証',
    mascot: { size: 180, startPosition: 'bottom-right', margin: 40, rememberPosition: true },
    actions: [{
      name: '休む',
      file: 'actions/rest.svg',
      weight: 1,
      durationMs: [6000, 10000],
      flipMode: 'none',
      imageTransform: { scale: 1, offsetX: 0, offsetY: 0 },
      movement: { type: 'horizontal', speed: 55 },
      effect: {
        file: 'effects/rest.svg',
        intervalMs: 450,
        size: 32,
        lifetimeMs: 1800,
        offsetX: 0,
        offsetY: 12,
        coordinateVersion: 2,
        emitWhileStill: false,
      },
    }],
  };
}

const numericInputs = [
  { id: 'action-weight', event: 'change', label: '選ばれやすさ' },
  { id: 'duration-min', event: 'input', label: '最短時間' },
  { id: 'duration-max', event: 'input', label: '最長時間' },
  { id: 'effect-interval', event: 'input', label: 'エフェクト間隔' },
  { id: 'effect-size', event: 'input', label: 'エフェクトサイズ' },
  { id: 'effect-lifetime', event: 'input', label: 'エフェクト表示時間' },
  { id: 'effect-offset-x', event: 'input', label: 'エフェクト横位置' },
  { id: 'effect-offset-y', event: 'input', label: 'エフェクト縦位置' },
  { id: 'movement-speed', event: 'input', label: '速さ' },
];

async function saveExpectingValidationError(settings) {
  const originalError = console.error;
  console.error = () => {};
  try {
    return await settings.api.saveConfiguration();
  } finally {
    console.error = originalError;
  }
}

test('empty numeric settings inputs show a field-specific save error', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    for (const field of numericInputs) {
      let saveCalls = 0;
      const settings = loadSettingsForTest({
        projectRoot,
        mascotAPI: {
          loadConfig: async () => ({ config: config() }),
          saveConfig: async (payload) => {
            saveCalls += 1;
            return { ok: true, applied: true, config: payload };
          },
        },
      });

      await settings.api.loadConfiguration();
      const input = settings.nodes.get(field.id);
      input.value = '';
      input.dispatchEvent({ type: field.event });

      assert.equal(await saveExpectingValidationError(settings), false, field.id);
      assert.equal(
        settings.api.elements.feedback.textContent,
        `動作1の${field.label}を入力してください。`,
        field.id,
      );
      assert.equal(saveCalls, 0, field.id);
    }
  });
});

test('non-numeric settings input is rejected and valid numeric inputs keep their conversions', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const invalid = loadSettingsForTest({
      projectRoot,
      mascotAPI: { loadConfig: async () => ({ config: config() }) },
    });
    await invalid.api.loadConfiguration();
    const invalidSize = invalid.nodes.get('effect-size');
    invalidSize.value = 'not a number';
    invalidSize.dispatchEvent({ type: 'input' });
    assert.equal(await saveExpectingValidationError(invalid), false);
    assert.equal(invalid.api.elements.feedback.textContent, '動作1のエフェクトサイズを入力してください。');

    let payload;
    const valid = loadSettingsForTest({
      projectRoot,
      mascotAPI: {
        loadConfig: async () => ({ config: config() }),
        saveConfig: async (nextPayload) => {
          payload = nextPayload;
          return { ok: true, applied: true, config: nextPayload };
        },
      },
    });
    await valid.api.loadConfiguration();

    const edits = [
      ['action-weight', 'change', '7'],
      ['duration-min', 'input', '1.5'],
      ['duration-max', 'input', '4'],
      ['movement-speed', 'input', '77'],
      ['effect-interval', 'input', '0.75'],
      ['effect-size', 'input', '48'],
      ['effect-lifetime', 'input', '2.25'],
      ['effect-offset-x', 'input', '-4'],
      ['effect-offset-y', 'input', '9'],
    ];
    for (const [id, event, value] of edits) {
      const input = valid.nodes.get(id);
      input.value = value;
      input.dispatchEvent({ type: event });
    }

    assert.equal(await valid.api.saveConfiguration(), true);
    assert.equal(payload.actions[0].weight, 7);
    assert.deepEqual(JSON.parse(JSON.stringify(payload.actions[0].durationMs)), [1500, 4000]);
    assert.equal(payload.actions[0].movement.speed, 77);
    assert.deepEqual(
      {
        intervalMs: payload.actions[0].effect.intervalMs,
        size: payload.actions[0].effect.size,
        lifetimeMs: payload.actions[0].effect.lifetimeMs,
        offsetX: payload.actions[0].effect.offsetX,
        offsetY: payload.actions[0].effect.offsetY,
      },
      { intervalMs: 750, size: 48, lifetimeMs: 2250, offsetX: -4, offsetY: 9 },
    );
  });
});

test('empty numeric inputs remain blank after switching, reordering, and adding actions', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    const emptyAction = {
      _uiId: 'empty-action',
      _assetUrl: null,
      name: '空欄の動作',
      file: 'actions/rest.svg',
      weight: 1,
      durationMs: [6000, 10000],
      flipMode: 'none',
      imageTransform: { scale: 1, offsetX: 0, offsetY: 0 },
      movement: { type: 'horizontal', speed: 55 },
      effect: {
        file: 'effects/rest.svg',
        _assetUrl: null,
        intervalMs: 450,
        size: 32,
        lifetimeMs: 1800,
        offsetX: 0,
        offsetY: 12,
      },
    };
    const otherAction = {
      ...emptyAction,
      _uiId: 'other-action',
      name: '別の動作',
      weight: 2,
      durationMs: [5000, 9000],
      movement: { type: 'horizontal', speed: 80 },
      effect: {
        ...emptyAction.effect,
        intervalMs: 500,
        size: 40,
        lifetimeMs: 2000,
        offsetX: 5,
        offsetY: 15,
      },
    };
    settings.api.state.actions = [emptyAction, otherAction];
    settings.api.state.selectedId = emptyAction._uiId;
    settings.api.renderActionList();
    settings.api.renderEditor();
    for (const field of numericInputs) {
      const input = settings.nodes.get(field.id);
      input.value = '';
      input.dispatchEvent({ type: field.event });
    }

    const assertEmptyInputs = () => {
      for (const field of numericInputs) {
        assert.equal(settings.nodes.get(field.id).value, '', field.id);
      }
      const emptyIndex = settings.api.state.actions.findIndex(
        (action) => action._uiId === emptyAction._uiId,
      );
      const weightInput = settings.api.elements.actionList.children[emptyIndex]
        .children[0].children[1].children[1];
      assert.equal(weightInput.value, '', 'action-list weight');
    };
    const selectAction = (id) => {
      const index = settings.api.state.actions.findIndex((action) => action._uiId === id);
      settings.api.elements.actionList.children[index]
        .children[0].children[0].dispatchEvent({ type: 'click' });
    };

    assertEmptyInputs();
    selectAction(otherAction._uiId);
    selectAction(emptyAction._uiId);
    assertEmptyInputs();

    settings.nodes.get('move-down').dispatchEvent({ type: 'click' });
    assertEmptyInputs();
    settings.nodes.get('move-up').dispatchEvent({ type: 'click' });
    assertEmptyInputs();

    settings.nodes.get('add-action').dispatchEvent({ type: 'click' });
    selectAction(emptyAction._uiId);
    assertEmptyInputs();
  });
});

test('missing shared rules disable the settings editor', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({
      projectRoot,
      provideConfigRules: false,
      runBoot: true,
    });
    assert.equal(settings.api.state.apiAvailable, false);
    assert.equal(settings.api.elements.saveButton.disabled, true);
    assert.match(settings.api.elements.feedback.textContent, /設定機能を利用できません/);
  });
});

test('null and undefined numeric values keep their default display', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    await settings.api.loadConfiguration();
    const action = settings.api.state.actions[0];
    action.weight = null;
    action.durationMs = [null, undefined];
    action.movement.speed = undefined;
    action.effect = {
      intervalMs: null,
      size: undefined,
      lifetimeMs: null,
      offsetX: undefined,
      offsetY: null,
      file: '',
    };
    settings.api.renderActionList();
    settings.api.renderEditor();

    assert.equal(settings.nodes.get('action-weight').value, 1);
    assert.equal(settings.nodes.get('duration-min').value, 6);
    assert.equal(settings.nodes.get('duration-max').value, 10);
    assert.equal(settings.nodes.get('movement-speed').value, 0);
    assert.equal(settings.nodes.get('effect-interval').value, 0.45);
    assert.equal(settings.nodes.get('effect-size').value, 32);
    assert.equal(settings.nodes.get('effect-lifetime').value, 1.8);
    assert.equal(settings.nodes.get('effect-offset-x').value, 0);
    assert.equal(settings.nodes.get('effect-offset-y').value, 12);
  });
});

test('prepareDistributionDefaults consistently reports whether it completed', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const packaged = loadSettingsForTest({
      projectRoot,
      mascotAPI: { getAppInfo: async () => ({ isPackaged: true }) },
    });
    await packaged.api.loadConfiguration();
    assert.equal(await packaged.api.prepareDistributionDefaults(), false);

    const development = loadSettingsForTest({
      projectRoot,
      mascotAPI: { prepareDistributionDefaults: async () => ({ ok: true }) },
    });
    await development.api.loadConfiguration();
    assert.equal(await development.api.prepareDistributionDefaults(), true);
  });
});

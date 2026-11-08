import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadSettingsForTest } from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

function createAction(id, name, imageTransform = { scale: 1, offsetX: 0, offsetY: 0 }, effect) {
  return {
    _uiId: id,
    name,
    file: `actions/${id}.svg`,
    weight: 1,
    durationMs: [6000, 10000],
    flipMode: 'none',
    imageTransform: { ...imageTransform },
    movement: { type: 'still', speed: 0 },
    _assetUrl: `data:image/svg+xml,${id}`,
    ...(effect ? { effect: { ...effect } } : {}),
  };
}

function configureSettings(settings, actions, {
  mascotSize = 180,
  selectedId = actions[0]._uiId,
  startPosition = 'bottom-right',
} = {}) {
  settings.window.screen = { availWidth: 1280, availHeight: 900 };
  settings.mascotAPI.getAssetMetadata = async (file) => ({ cacheKey: file });
  settings.api.state.config = {
    name: 'サイズ調整テスト',
    mascot: {
      size: mascotSize,
      startPosition,
      margin: 40,
      rememberPosition: true,
    },
  };
  settings.api.state.actions = actions;
  settings.api.state.selectedId = selectedId;
  settings.api.state.dirty = false;
  settings.api.sizeMeasurementCache.clear();
}

function cacheMeasurements(settings, measurements) {
  for (const action of settings.api.state.actions) {
    const measurement = measurements[action._uiId];
    if (!measurement) continue;
    settings.api.sizeMeasurementCache.set(`${action._assetUrl}|${action.file}`, {
      promise: Promise.resolve(measurement),
      expiresAt: Date.now() + 60_000,
    });
  }
}

async function openSizeManager(settings) {
  settings.nodes.get('open-size-manager').dispatchEvent({ type: 'click' });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function setMascotSlider(settings, size) {
  const slider = settings.api.elements.sizeManagerMascotSlider;
  slider.value = String(size);
  slider.oninput();
}

function setTargetSlider(settings, percentage) {
  const slider = settings.api.elements.sizeManagerTargetSlider;
  slider.value = String(percentage);
  slider.oninput();
}

function actionMeasurement(baseWidth, baseHeight = baseWidth, centerX = 0.5, centerY = 0.5) {
  return { baseWidth, baseHeight, centerX, centerY };
}

test('overall size controls synchronize, save changes, and cancel without mutation', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    let saveCalls = 0;
    let savedPayload;
    const settings = loadSettingsForTest({
      projectRoot,
      mascotAPI: {
        saveConfig: async (config) => {
          saveCalls += 1;
          savedPayload = config;
          return { ok: true, applied: true, config };
        },
      },
    });
    const actions = [createAction('one', '画像1')];
    configureSettings(settings, actions, { startPosition: 'top-left' });
    cacheMeasurements(settings, { one: actionMeasurement(0.5) });

    await openSizeManager(settings);
    const elements = settings.api.elements;
    assert.equal(elements.sizeManagerMascotSize.value, '180');
    assert.equal(elements.sizeManagerScreenPercent.value, '20');
    assert.equal(elements.sizeManagerMaxInfo.textContent, '最大 876px');
    assert.equal(elements.sizeManagerScreenDiagram.style.aspectRatio, '1280 / 900');
    assert.equal(elements.sizeManagerScreenDiagramMascot.style.width, '14.0625%');
    assert.equal(elements.sizeManagerScreenDiagramMascot.style.height, '20%');
    assert.equal(elements.sizeManagerScreenDiagramMascot.style.left, '0');
    assert.equal(elements.sizeManagerScreenDiagramMascot.style.top, '0');
    assert.match(elements.sizeManagerScreenDiagram['aria-label'], /画面の高さの 20%/);
    assert.match(elements.sizeManagerMaxMarker.style.left, /%$/);

    elements.sizeManagerMascotSize.value = '360';
    elements.sizeManagerMascotSize.oninput();
    assert.equal(elements.sizeManagerMascotSlider.value, '360');
    assert.equal(elements.sizeManagerScreenPercent.value, '40');
    assert.equal(elements.sizeManagerScreenDiagramMascot.style.width, '28.125%');
    assert.equal(elements.sizeManagerScreenDiagramMascot.style.height, '40%');
    assert.equal(settings.api.state.config.mascot.size, 180);

    elements.sizeManagerScreenPercent.value = '50';
    elements.sizeManagerScreenPercent.oninput();
    assert.equal(elements.sizeManagerMascotSize.value, '450');
    assert.equal(elements.sizeManagerMascotSlider.value, '450');
    assert.equal(elements.sizeManagerScreenDiagramMascot.style.width, '35.15625%');
    assert.equal(elements.sizeManagerScreenDiagramMascot.style.height, '50%');
    assert.equal(elements.sizeManagerScreenDiagramCaption.textContent, '画面の高さの 50%');

    setMascotSlider(settings, 1000);
    assert.equal(elements.sizeManagerSizeWarning.hidden, false);
    assert.equal(elements.sizeManagerSizeWarning.textContent, '画面に収まらないため、876pxに縮めて表示されます。');
    assert.equal(elements.sizeManagerScreenDiagramMascot.style.width, elements.sizeManagerScreenDiagramMaximum.style.width);
    assert.equal(elements.sizeManagerScreenDiagramMascot.style.height, elements.sizeManagerScreenDiagramMaximum.style.height);
    assert.match(elements.sizeManagerScreenDiagram['aria-label'], /表示は876px/);
    elements.sizeManagerDialog.oncancel({ preventDefault() {} });
    assert.equal(settings.api.state.config.mascot.size, 180);
    assert.equal(settings.api.state.dirty, false);

    settings.api.state.config.mascot.startPosition = 'center';
    await openSizeManager(settings);
    assert.equal(elements.sizeManagerScreenDiagramMascot.style.left, '50%');
    assert.equal(elements.sizeManagerScreenDiagramMascot.style.top, '50%');
    assert.equal(elements.sizeManagerScreenDiagramMascot.style.transform, 'translate(-50%, -50%)');
    setMascotSlider(settings, 250);
    await elements.sizeManagerSave.onclick();
    assert.equal(settings.api.state.config.mascot.size, 250);
    assert.equal(settings.api.state.dirty, false);
    assert.equal(elements.mascotSize.value, 250);
    assert.equal(elements.mascotSizeOutput.textContent, '250 px');
    assert.equal(saveCalls, 1);
    assert.equal(savedPayload.mascot.size, 250);
  });
});

test('screen diagram anchors to every configured start position', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    const actions = [createAction('one', '画像1')];
    configureSettings(settings, actions);
    cacheMeasurements(settings, { one: actionMeasurement(0.5) });

    for (const [position, expected] of [
      ['top-left', { left: '0', top: '0' }],
      ['top-right', { right: '0', top: '0' }],
      ['bottom-left', { left: '0', bottom: '0' }],
      ['bottom-right', { right: '0', bottom: '0' }],
      ['center', { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }],
    ]) {
      settings.api.state.config.mascot.startPosition = position;
      await openSizeManager(settings);
      const box = settings.api.elements.sizeManagerScreenDiagramMascot.style;
      for (const property of ['left', 'right', 'top', 'bottom', 'transform']) {
        assert.equal(box[property], expected[property] || '');
      }
      settings.api.elements.sizeManagerCancel.onclick();
    }
  });
});

test('effect scaling rounds and clamps values from the size at dialog open', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    const actions = [
      createAction('round', '丸め', undefined, {
        file: 'effects/round.svg',
        size: 33,
        offsetX: 17,
        offsetY: -19,
        intervalMs: 450,
        lifetimeMs: 1800,
      }),
      createAction('clamp', '上限', undefined, {
        file: 'effects/clamp.svg',
        size: 900,
        offsetX: 4000,
        offsetY: -4000,
        intervalMs: 450,
        lifetimeMs: 1800,
      }),
      createAction('none', 'エフェクトなし'),
    ];
    configureSettings(settings, actions);
    cacheMeasurements(settings, {
      round: actionMeasurement(0.5),
      clamp: actionMeasurement(0.5),
      none: actionMeasurement(0.5),
    });

    await openSizeManager(settings);
    setMascotSlider(settings, 270);
    await settings.api.elements.sizeManagerSave.onclick();

    assert.deepEqual(
      actions.map((action) => action.effect && ({
        size: action.effect.size,
        offsetX: action.effect.offsetX,
        offsetY: action.effect.offsetY,
      })),
      [
        { size: 50, offsetX: 26, offsetY: -28 },
        { size: 1000, offsetX: 5000, offsetY: -5000 },
        undefined,
      ],
    );
  });
});

test('effect scaling can be disabled and repeated size changes do not accumulate rounding', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    const action = createAction('effect', 'エフェクト', undefined, {
      file: 'effects/effect.svg',
      size: 33,
      offsetX: 17,
      offsetY: -19,
      intervalMs: 450,
      lifetimeMs: 1800,
    });
    configureSettings(settings, [action]);
    cacheMeasurements(settings, { effect: actionMeasurement(0.5) });

    await openSizeManager(settings);
    setMascotSlider(settings, 720);
    setMascotSlider(settings, 180);
    await settings.api.elements.sizeManagerSave.onclick();
    assert.deepEqual(
      { size: action.effect.size, offsetX: action.effect.offsetX, offsetY: action.effect.offsetY },
      { size: 33, offsetX: 17, offsetY: -19 },
    );

    await openSizeManager(settings);
    settings.api.elements.sizeManagerScaleEffects.checked = false;
    setMascotSlider(settings, 360);
    await settings.api.elements.sizeManagerSave.onclick();
    assert.deepEqual(
      { size: action.effect.size, offsetX: action.effect.offsetX, offsetY: action.effect.offsetY },
      { size: 33, offsetX: 17, offsetY: -19 },
    );
  });
});

test('effect size respects its minimum when the overall size is reduced', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    const action = createAction('minimum', '最小エフェクト', undefined, {
      file: 'effects/minimum.svg',
      size: 4,
      offsetX: 12,
      offsetY: -12,
      intervalMs: 450,
      lifetimeMs: 1800,
    });
    configureSettings(settings, [action]);
    cacheMeasurements(settings, { minimum: actionMeasurement(0.5) });

    await openSizeManager(settings);
    setMascotSlider(settings, 90);
    await settings.api.elements.sizeManagerSave.onclick();

    assert.equal(action.effect.size, 4);
    assert.equal(action.effect.offsetX, 6);
    assert.equal(action.effect.offsetY, -6);
  });
});

test('alignment range identifies limiting images and aligns all measured images to the chosen target', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    const actions = [
      createAction('small', '小さい画像'),
      createAction('large', '大きい画像'),
      createAction('middle', '中間の画像'),
    ];
    configureSettings(settings, actions, { selectedId: 'small' });
    cacheMeasurements(settings, {
      small: actionMeasurement(0.1),
      large: actionMeasurement(0.8),
      middle: actionMeasurement(0.6),
    });

    await openSizeManager(settings);
    const elements = settings.api.elements;
    assert.match(elements.sizeManagerRangeStatus.textContent, /24〜30%/);
    assert.equal(elements.sizeManagerRangeStatus.classList.contains('is-error'), false);
    assert.equal(elements.sizeManagerTargetOutput.textContent, '24%');

    const largeCardRadio = elements.sizeManagerGrid.children[1].children[0].children[0];
    largeCardRadio.dispatchEvent({ type: 'change' });
    assert.equal(elements.sizeManagerTargetOutput.textContent, '30%');
    setTargetSlider(settings, 30);
    elements.sizeManagerAuto.onclick();
    await elements.sizeManagerSave.onclick();

    const scales = actions.map((action) => action.imageTransform.scale);
    [3, 0.375, 0.5].forEach((expected, index) => {
      assert.ok(Math.abs(scales[index] - expected) < 1e-12);
    });
    for (const action of actions) {
      const base = { small: 0.1, large: 0.8, middle: 0.6 }[action._uiId];
      assert.ok(Math.abs(base * action.imageTransform.scale - 0.3) <= 0.01);
    }
    assert.equal(elements.sizeManagerTargetOutput.textContent, '30%');
  });
});

test('an impossible alignment range warns with both limiting image names and still clamps auto alignment', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    const actions = [
      createAction('large', '大きすぎる画像'),
      createAction('small', '小さすぎる画像'),
      createAction('middle', '中間の画像'),
    ];
    configureSettings(settings, actions, { selectedId: 'large' });
    cacheMeasurements(settings, {
      large: actionMeasurement(0.95),
      small: actionMeasurement(0.05),
      middle: actionMeasurement(0.5),
    });

    await openSizeManager(settings);
    const elements = settings.api.elements;
    assert.match(elements.sizeManagerRangeStatus.textContent, /範囲が成立しません/);
    assert.match(elements.sizeManagerRangeStatus.textContent, /大きすぎる画像/);
    assert.match(elements.sizeManagerRangeStatus.textContent, /小さすぎる画像/);
    assert.equal(elements.sizeManagerTargetSlider.disabled, true);
    assert.equal(elements.sizeManagerAuto.disabled, false);

    elements.sizeManagerAuto.onclick();
    await elements.sizeManagerSave.onclick();
    assert.equal(elements.sizeManagerDialog.open, false);
    for (const action of actions) {
      assert.ok(action.imageTransform.scale >= 0.3 && action.imageTransform.scale <= 3);
    }
    assert.match(elements.sizeManagerStatus.textContent, /できる範囲で揃えました/);
  });
});

test('size manager save persists the overall size, image transforms, and scaled effects once', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const savedPayloads = [];
    const settings = loadSettingsForTest({
      projectRoot,
      mascotAPI: {
        saveConfig: async (config) => {
          savedPayloads.push(config);
          return { ok: true, applied: true, config };
        },
      },
    });
    const actions = [createAction('one', '画像1', { scale: 1.25, offsetX: 10, offsetY: -20 }, {
      file: 'effects/one.svg',
      size: 80,
      offsetX: 100,
      offsetY: -120,
      intervalMs: 450,
      lifetimeMs: 1800,
    })];
    configureSettings(settings, actions);
    cacheMeasurements(settings, { one: actionMeasurement(0.5) });

    await openSizeManager(settings);
    setMascotSlider(settings, 360);
    await settings.api.elements.sizeManagerSave.onclick();

    assert.equal(savedPayloads.length, 1);
    assert.equal(savedPayloads[0].mascot.size, 360);
    assert.deepEqual(
      JSON.parse(JSON.stringify(savedPayloads[0].actions[0].effect)),
      {
        file: 'effects/one.svg',
        intervalMs: 450,
        size: 160,
        lifetimeMs: 1800,
        offsetX: 200,
        offsetY: -240,
        coordinateVersion: 2,
        emitWhileStill: false,
      },
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(savedPayloads[0].actions[0].imageTransform)),
      { flipX: false, scale: 1.25, offsetX: 10, offsetY: -20 },
    );
    assert.equal(settings.api.elements.sizeManagerDialog.open, false);
    assert.equal(settings.api.state.dirty, false);
  });
});

test('size manager exposes controls for the maximum marker and alignment target', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const html = fs.readFileSync(path.join(projectRoot, 'settings.html'), 'utf8');
    const css = fs.readFileSync(path.join(projectRoot, 'settings.css'), 'utf8');
    assert.match(html, /id="size-manager-mascot-slider" type="range" min="32" max="1000"/);
    assert.match(html, /id="size-manager-mascot-size" type="number" min="32" max="1000"/);
    assert.match(html, /id="size-manager-screen-percent" type="number"/);
    assert.match(html, /id="size-manager-screen-diagram"[^>]+role="img"/);
    assert.match(html, /id="size-manager-scale-effects" type="checkbox" checked/);
    assert.match(html, /id="size-manager-max-marker"/);
    assert.match(html, /id="size-manager-target-slider" type="range"/);
    assert.match(html, /<h3 id="size-manager-alignment-title">大きさを揃える<\/h3>/);
    assert.doesNotMatch(html, /size-manager-target-actual|size-manager-lower-limit|size-manager-upper-limit|size-manager-upper-hint/);
    assert.ok(html.indexOf('id="size-manager-scale-effects"') < html.indexOf('class="size-manager-screen-diagram-layout"'));
    assert.match(css, /\.size-manager-max-marker\s*\{[^}]*position:\s*absolute;/);
    assert.match(css, /\.size-manager-overall-fields\s*\{/);
    assert.match(css, /\.size-manager-target-fields\s*\{/);
    assert.match(css, /\.size-manager-screen-diagram\s*\{[^}]*width:\s*min\(240px,\s*100%\)/);
    assert.match(css, /\.size-manager-overall-fields \.field-label-row,\s*\.size-manager-target-fields \.field-label-row\s*\{\s*justify-content:\s*flex-start;\s*gap:\s*8px;/);
  });
});

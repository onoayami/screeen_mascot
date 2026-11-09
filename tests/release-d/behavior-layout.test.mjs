import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  loadMainForTest,
  loadRendererForTest,
  loadSettingsForTest,
} from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

let chromium;
let playwrightSkipReason = false;
try {
  ({ chromium } = await import('playwright'));
} catch (error) {
  if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error?.code)) throw error;
  playwrightSkipReason = 'Playwright が未導入のため、レイアウト検査を実行できません。`npm i -D playwright` と `npx playwright install chromium` を実行してください';
}

function seededRandom(seed = 0x5eed1234) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} body was not found`);
  return source.slice(start, end);
}

test('D-01: the current action remains eligible for weighted selection', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot, random: () => 0 });
    const current = { name: 'current', weight: 10 };
    const other = { name: 'other', weight: 1 };
    renderer.api.state.actions = [current, other];
    renderer.api.state.currentAction = current;
    assert.equal(renderer.api.chooseWeightedAction(), current);
  });
});

test('D-02: long-run selection follows weights and permits consecutive actions', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot, random: seededRandom() });
    const heavy = { name: 'heavy', weight: 10 };
    const light = { name: 'light', weight: 1 };
    renderer.api.state.actions = [heavy, light];
    const counts = new Map([[heavy, 0], [light, 0]]);
    let consecutive = 0;
    let previous = null;
    for (let index = 0; index < 20_000; index += 1) {
      const selected = renderer.api.chooseWeightedAction();
      counts.set(selected, counts.get(selected) + 1);
      if (selected === previous) consecutive += 1;
      previous = selected;
      renderer.api.state.currentAction = selected;
    }
    const ratio = counts.get(heavy) / counts.get(light);
    assert.ok(ratio > 8 && ratio < 12, `actual ratio: ${ratio}`);
    assert.ok(consecutive > 0, 'consecutive actions should be possible');
  });
});

test('D-03: mascot position rendering uses compositor-friendly translate3d', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const renderer = loadRendererForTest({ projectRoot });
    renderer.api.state.position = { x: 12.5, y: 34 };
    renderer.api.renderPosition();
    const mascot = renderer.nodes.get('mascot');
    assert.equal(mascot.style.transform, 'translate3d(12.5px, 34px, 0)');
    assert.equal(mascot.style.left || '', '');
    assert.equal(mascot.style.top || '', '');
  });
});

test('D-04: editing an action name updates its card without rebuilding the list', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const settings = loadSettingsForTest({ projectRoot });
    settings.api.state.actions = [{
      _uiId: 'action-one',
      _assetUrl: null,
      name: '変更前',
      file: 'actions/rest.svg',
      weight: 1,
      durationMs: [5000, 9000],
      movement: { type: 'still', speed: 0 },
    }];
    settings.api.state.selectedId = 'action-one';
    settings.api.renderActionList();
    const listItem = settings.api.elements.actionList.children[0];
    const nameNode = listItem.children[0].children[0].children[1].children[0];
    settings.api.elements.actionName.value = '変更後の長い動作名';
    settings.api.updateActionName();
    assert.equal(settings.api.elements.actionList.children[0], listItem);
    assert.equal(nameNode.textContent, '変更後の長い動作名');
  });
});

test('D-05: display selection uses one scan rather than sorting every display', async () => {
  await withTemporaryProject(async ({ projectRoot, userDataRoot }) => {
    const displays = [
      { id: 'left', workArea: { x: 0, y: 0, width: 800, height: 600 } },
      { id: 'right', workArea: { x: 800, y: 0, width: 800, height: 600 } },
      { id: 'far', workArea: { x: 1600, y: 0, width: 800, height: 600 } },
    ];
    const main = loadMainForTest({
      projectRoot,
      userDataRoot,
      screenOverrides: {
        getAllDisplays: () => displays,
        getDisplayNearestPoint: () => displays[0],
      },
    });
    assert.equal(
      main.api.selectDisplayForMascot({ x: 900, y: 20, width: 500, height: 500 }).id,
      'right',
    );
    const source = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
    const body = functionBody(source, 'selectDisplayForMascot', 'ensureMascotWindowOnScreen');
    assert.doesNotMatch(body, /\.sort\s*\(/);
  });
});

test('D-06: obsolete one-off footprint migration is removed', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const source = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
    assert.doesNotMatch(source, /function\s+migrateLegacyDefaultFootprint\s*\(/);
    assert.match(source, /function\s+migrateLegacyDefaultAssets\s*\(/);
  });
});

test('D-07: responsive media queries preserve compact overrides and appearance columns', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const css = fs.readFileSync(path.join(projectRoot, 'settings.css'), 'utf8');
    const start = css.indexOf('@media (max-width: 680px)');
    const end = css.indexOf('@media (prefers-color-scheme: dark)', start);
    assert.ok(start >= 0 && end > start);
    const narrow = css.slice(start, end);
    assert.equal((narrow.match(/\.size-manager-grid\s*\{/g) || []).length, 1);
    assert.equal((narrow.match(/\.size-card\s*\{/g) || []).length, 0);

    assert.match(
      css,
      /\.image-and-fields\s*\{[^}]*grid-template-columns:\s*minmax\(230px,\s*0\.85fr\)\s+minmax\(280px,\s*1\.15fr\);/,
    );
    const medium = css.match(
      /@media \(min-width: 901px\) and \(max-width: 1120px\)\s*\{([^}]+)\}/,
    )?.[1];
    assert.ok(medium);
    assert.doesNotMatch(medium, /\.movement-grid/);
    assert.match(medium, /\.effect-settings/);
    assert.match(
      css,
      /@media \(min-width: 901px\) and \(max-width: 949px\)\s*\{\s*\.movement-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);\s*\}\s*\}/,
    );
    assert.doesNotMatch(medium, /\.image-and-fields/);
    assert.match(
      css,
      /@media \(max-width: 970px\)\s*\{\s*\.image-and-fields\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);\s*\}\s*\}/,
    );
  });
});

test('D-10: image editing follows the duration fields in the STEP 1 right column', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const html = fs.readFileSync(path.join(projectRoot, 'settings.html'), 'utf8');
    const imageControlStack = html.match(
      /<div id="image-control-stack" class="image-control-stack">([\s\S]*?)<\/div>\s*<div class="fields-stack">/,
    )?.[1];
    const fieldsStack = html.match(
      /<div class="fields-stack">([\s\S]*?)<\/div>\s*<\/div>\s*<\/section>/,
    )?.[1];
    assert.ok(imageControlStack);
    assert.ok(fieldsStack);
    assert.doesNotMatch(imageControlStack, /id="image-edit-button"/);
    assert.match(
      fieldsStack,
      /<input id="duration-max"[^>]*\/>\s*<\/label>\s*<\/div>\s*<button id="image-edit-button"/,
    );

    const css = fs.readFileSync(path.join(projectRoot, 'settings.css'), 'utf8');
    assert.match(css, /\.image-edit-button\s*\{\s*width:\s*100%;\s*margin-top:\s*12px;\s*font-size:\s*13px;\s*\}/);
  });
});

test('D-11: image flip control follows the dropzone and matches the field label typography', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const html = fs.readFileSync(path.join(projectRoot, 'settings.html'), 'utf8');
    const imageControlStack = html.match(
      /<div id="image-control-stack" class="image-control-stack">([\s\S]*?)<\/div>\s*<div class="fields-stack">/,
    )?.[1];
    assert.ok(imageControlStack);
    assert.match(
      imageControlStack,
      /<\/button>\s*<label class="check-row image-flip-control">\s*<input id="image-flip-x" type="checkbox"\s*\/>\s*<span>画像を左右反転する<\/span>\s*<\/label>\s*<div class="preview-toolbar">/,
    );
    assert.match(imageControlStack, /<div class="preview-toolbar">[\s\S]*?<div class="action-image-feedback">/);

    const css = fs.readFileSync(path.join(projectRoot, 'settings.css'), 'utf8');
    assert.match(css, /#action-dropzone\.has-image\s*\{[^}]*border-width:\s*2px;[^}]*padding:\s*36px\s+20px\s+16px;/);
    assert.match(css, /\.image-and-fields\s*>\s*\.fields-stack\s*\{\s*align-self:\s*start;\s*\}/);
    assert.match(
      css,
      /\.field,\s*\.image-flip-control\s*\{\s*font-size:\s*13px;\s*font-weight:\s*600;\s*\}/,
    );
    assert.match(css, /\.image-flip-control\s*\{[^}]*justify-self:\s*center;[^}]*color:\s*var\(--text\);/);
    assert.match(css, /\.aligned-field-grid \.field > span:first-child\s*\{\s*align-self:\s*start;\s*line-height:\s*20px;\s*\}/);
  });
});

test('D-08: settings layout has no horizontal overflow at target widths', { skip: playwrightSkipReason }, async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || '/usr/local/bin/chromium',
    });
    const page = await browser.newPage();
    const measurements = [];
    try {
      await page.goto(pathToFileURL(path.join(projectRoot, 'settings.html')).href);
      for (const width of [680, 760, 900, 901, 949, 950, 970, 980, 1000, 1040, 1120, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        measurements.push(await page.evaluate(async (viewportWidth) => {
          document.querySelector('#action-editor').hidden = false;
          document.querySelector('#effect-settings').hidden = false;
          const dropzone = document.querySelector('#action-dropzone');
          dropzone.classList.add('has-image');
          document.querySelector('#action-preview-frame').hidden = false;
          document.querySelector('#action-preview-marker').hidden = false;
          document.querySelector('#save-state').textContent = 'デスクトップアプリが必要';
          document.documentElement.style.fontSize = viewportWidth === 1000 ? '22px' : '16px';
          document.querySelector('#action-list').innerHTML = `
            <li><div class="action-item-card"><button class="action-item-select">
              <span class="action-copy"><span class="action-name">とても長い動作名を入力した場合でも一覧と編集画面が横にはみ出さないことを確認します</span></span>
            </button></div></li>`;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const selectors = ['.image-and-fields', '.movement-grid', '.effect-settings'];
          const rect = (selector) => {
            const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
            return { x, y, width, height };
          };
          const dropzoneRect = dropzone.getBoundingClientRect();
          const flipControlRect = document.querySelector('.image-flip-control').getBoundingClientRect();
          const imageFrameRect = document.querySelector('#action-preview-frame').getBoundingClientRect();
          const frequencyLabelRect = document.querySelector('.aligned-field-grid .field > span:first-child').getBoundingClientRect();
          const flipDirection = getComputedStyle(document.querySelector('#flip-direction'));
          const flipControl = getComputedStyle(document.querySelector('.image-flip-control'));
          const topbarRect = document.querySelector('.topbar').getBoundingClientRect();
          const headerSaveRect = document.querySelector('#save-button-header').getBoundingClientRect();
          const saveStateRect = document.querySelector('#save-state').getBoundingClientRect();
          const previewGeometry = [32, 139, 216].map((size) => {
            const frame = document.querySelector('#action-preview-frame');
            frame.style.width = `${size}px`;
            frame.style.height = `${size}px`;
            const frameRect = frame.getBoundingClientRect();
            const markerRect = document.querySelector('#action-preview-marker').getBoundingClientRect();
            const zoneRect = dropzone.getBoundingClientRect();
            const zoneStyle = getComputedStyle(dropzone);
            return {
              size,
              frameWidth: frameRect.width,
              frameHeight: frameRect.height,
              markerBottom: markerRect.bottom,
              frameTop: frameRect.top,
              zoneTop: zoneRect.top,
              zoneBottom: zoneRect.bottom,
              borderTop: zoneStyle.borderTopWidth,
              borderBottom: zoneStyle.borderBottomWidth,
            };
          });
          return {
            width: viewportWidth,
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            columns: Object.fromEntries(selectors.map((selector) => {
              const value = getComputedStyle(document.querySelector(selector)).gridTemplateColumns.trim();
              return [selector, value === 'none' || value === '' ? 0 : value.split(/\s+/).length];
            })),
            dropzone: rect('#action-dropzone'),
            flipControl: rect('.image-flip-control'),
            imageFrameTop: imageFrameRect.top,
            frequencyLabelTop: frequencyLabelRect.top,
            flipTypography: {
              fontSize: flipControl.fontSize,
              fontWeight: flipControl.fontWeight,
              fontFamily: flipControl.fontFamily,
              fontStyle: flipControl.fontStyle,
              color: flipControl.color,
            },
            selectTypography: {
              fontSize: flipDirection.fontSize,
              fontWeight: flipDirection.fontWeight,
              fontFamily: flipDirection.fontFamily,
              fontStyle: flipDirection.fontStyle,
              color: flipDirection.color,
            },
            checkboxSize: rect('#image-flip-x'),
            topbar: { left: topbarRect.left, right: topbarRect.right },
            headerSave: { left: headerSaveRect.left, right: headerSaveRect.right },
            saveState: { left: saveStateRect.left, right: saveStateRect.right },
            previewGeometry,
          };
        }, width));
      }
    } finally {
      await browser.close();
    }

    for (const measurement of measurements) {
      assert.ok(
        measurement.scrollWidth <= measurement.clientWidth + 1,
        `${measurement.width}px overflowed: ${measurement.scrollWidth} > ${measurement.clientWidth}`,
      );
      assert.ok(measurement.headerSave.left >= measurement.topbar.left);
      assert.ok(measurement.saveState.right <= measurement.topbar.right);
      assert.ok(measurement.headerSave.right <= measurement.saveState.left);
      for (const preview of measurement.previewGeometry) {
        assert.equal(preview.frameWidth, preview.size);
        assert.equal(preview.frameHeight, preview.size);
        assert.equal(preview.borderTop, '2px');
        assert.equal(preview.borderBottom, '2px');
        assert.ok(
          preview.markerBottom < preview.frameTop - 1,
          `${measurement.width}px ${preview.size}px marker overlaps the frame`,
        );
        assert.ok(preview.frameTop - 1 > preview.zoneTop + 2);
        assert.ok(preview.frameTop + preview.frameHeight + 1 < preview.zoneBottom - 2);
      }
      assert.deepEqual(
        measurement.flipTypography,
        measurement.selectTypography,
        `${measurement.width}px flip checkbox typography differs from the direction select`,
      );
      assert.ok(
        Math.abs(
          measurement.flipControl.x + measurement.flipControl.width / 2
          - (measurement.dropzone.x + measurement.dropzone.width / 2),
        ) <= 1,
        `${measurement.width}px flip control is not centered below the dropzone`,
      );
      assert.equal(measurement.checkboxSize.width, 18);
      assert.equal(measurement.checkboxSize.height, 18);
      if (measurement.width > 970) {
        assert.ok(
          Math.abs(measurement.imageFrameTop - measurement.frequencyLabelTop) <= 1,
          `${measurement.width}px image frame and frequency label tops differ`,
        );
      }
      if (measurement.width >= 901 && measurement.width <= 1120) {
        const appearanceColumns = measurement.width <= 970 ? 1 : 2;
        assert.equal(
          measurement.columns['.image-and-fields'],
          appearanceColumns,
          `${measurement.width}px appearance layout had ${measurement.columns['.image-and-fields']} columns`,
        );
        assert.equal(
          measurement.columns['.movement-grid'],
          measurement.width <= 949 ? 1 : 2,
          `${measurement.width}px movement layout had ${measurement.columns['.movement-grid']} columns`,
        );
        assert.equal(
          measurement.columns['.effect-settings'],
          1,
          `${measurement.width}px effect layout had ${measurement.columns['.effect-settings']} columns`,
        );
      }
    }
  });
});

test('D-09: UI and guide distinguish selection count from duration and disclose repeats', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const html = fs.readFileSync(path.join(projectRoot, 'settings.html'), 'utf8');
    const guide = fs.readFileSync(path.join(projectRoot, 'docs', '02_画像と動きの設定.md'), 'utf8');
    assert.match(html, /選択回数/);
    assert.match(html, /同じ動作が連続/);
    assert.match(guide, /選択回数/);
    assert.match(guide, /同じ動作が連続/);
  });
});

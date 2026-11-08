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

test('D-07: the narrow media query contains only final size-manager overrides', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const css = fs.readFileSync(path.join(projectRoot, 'settings.css'), 'utf8');
    const start = css.indexOf('@media (max-width: 680px)');
    const end = css.indexOf('@media (prefers-color-scheme: dark)', start);
    assert.ok(start >= 0 && end > start);
    const narrow = css.slice(start, end);
    assert.equal((narrow.match(/\.size-manager-grid\s*\{/g) || []).length, 1);
    assert.equal((narrow.match(/\.size-card\s*\{/g) || []).length, 0);
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
      for (const width of [760, 900, 901, 1000, 1120]) {
        await page.setViewportSize({ width, height: 900 });
        measurements.push(await page.evaluate(async (viewportWidth) => {
          document.querySelector('#action-editor').hidden = false;
          document.querySelector('#effect-settings').hidden = false;
          document.documentElement.style.fontSize = viewportWidth === 1000 ? '22px' : '16px';
          document.querySelector('#action-list').innerHTML = `
            <li><div class="action-item-card"><button class="action-item-select">
              <span class="action-copy"><span class="action-name">とても長い動作名を入力した場合でも一覧と編集画面が横にはみ出さないことを確認します</span></span>
            </button></div></li>`;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const selectors = ['.image-and-fields', '.movement-grid', '.effect-settings'];
          return {
            width: viewportWidth,
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            columns: Object.fromEntries(selectors.map((selector) => {
              const value = getComputedStyle(document.querySelector(selector)).gridTemplateColumns.trim();
              return [selector, value === 'none' || value === '' ? 0 : value.split(/\s+/).length];
            })),
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
      if (measurement.width >= 901 && measurement.width <= 1120) {
        for (const [selector, columnCount] of Object.entries(measurement.columns)) {
          assert.equal(columnCount, 1, `${measurement.width}px ${selector} had ${columnCount} columns`);
        }
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

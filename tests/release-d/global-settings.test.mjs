import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadSettingsForTest } from '../phase0/helpers/loaders.mjs';
import { withTemporaryProject } from '../phase0/helpers/workspace.mjs';

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

test('global settings expose only mascot size and remembered position', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const html = fs.readFileSync(path.join(projectRoot, 'settings.html'), 'utf8');
    const source = fs.readFileSync(path.join(projectRoot, 'settings.js'), 'utf8');

    assert.match(html, /id="mascot-size"/);
    assert.match(html, /id="remember-position"/);
    assert.doesNotMatch(html, /id="mascot-name"|id="start-position"/);
    assert.doesNotMatch(source, /mascotName|elements\.startPosition/);
    assert.match(html, /id="action-name"/);
  });
});

test('global checkbox rows use compact frequency-label typography without changing other check rows', () => {
  const html = fs.readFileSync(new URL('../../settings.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../../settings.css', import.meta.url), 'utf8');
  const globalPanel = html.match(/<section class="panel global-panel"[\s\S]*?<\/section>/)?.[0];
  assert.ok(globalPanel);
  for (const id of ['remember-position', 'login-at-startup']) {
    assert.match(globalPanel, new RegExp(`<label class="check-row">\\s*<input id="${id}"[\\s\\S]*?<span>[^<]+<\\/span>\\s*<\\/label>`));
  }

  const globalCheckRow = css.match(/\.global-panel > \.check-row\s*\{([^}]*)\}/)?.[1];
  assert.ok(globalCheckRow);
  assert.match(globalCheckRow, /min-height:\s*24px;/);
  assert.match(globalCheckRow, /margin-top:\s*8px;/);
  assert.match(globalCheckRow, /color:\s*#000;/);
  assert.match(globalCheckRow, /font-size:\s*13px;/);
  assert.match(globalCheckRow, /font-weight:\s*600;/);
  assert.match(globalCheckRow, /line-height:\s*20px;/);
  const sharedCheckRow = css.match(/\.check-row,\s*\.switch-row,\s*\.check-card\s*\{([^}]*)\}/)?.[1];
  assert.ok(sharedCheckRow);
  assert.match(sharedCheckRow, /min-height:\s*44px;/);
  assert.match(sharedCheckRow, /font-size:\s*14px;/);
  assert.match(css, /\.login-item-status\s*\{[^}]*margin:\s*2px 0 0 28px;[^}]*color:\s*var\(--text-secondary\);[^}]*font-size:\s*12px;/);
  assert.match(css, /\.login-item-status\.is-error\s*\{[^}]*color:\s*#a33b2f;/);
  assert.match(css, /\.check-row input,[\s\S]*?width:\s*18px;[\s\S]*?height:\s*18px;/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{[\s\S]*?\.global-panel > \.check-row > span\s*\{\s*background-color:\s*#fff;/);
});

test('saving remaining global settings preserves the configured mascot name and start position', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    const initialConfig = {
      name: 'カスタムマスコット',
      mascot: {
        size: 180,
        startPosition: 'center',
        margin: 40,
        rememberPosition: true,
      },
      actions: [{
        name: '休む',
        file: 'actions/rest.svg',
        weight: 1,
        durationMs: [6000, 10000],
        movement: { type: 'still', speed: 0 },
      }],
    };
    const savedPayloads = [];
    const settings = loadSettingsForTest({
      projectRoot,
      ImageClass: LoadingImage,
      mascotAPI: {
        loadConfig: async () => ({ config: structuredClone(initialConfig) }),
        saveConfig: async (config) => {
          savedPayloads.push(config);
          return { ok: true, applied: true, config };
        },
      },
    });

    await settings.api.loadConfiguration();
    assert.equal(settings.api.elements.mascotSize.value, 180);
    assert.equal(settings.api.elements.rememberPosition.checked, true);

    settings.api.elements.mascotSize.value = '240';
    settings.api.elements.mascotSize.dispatchEvent({ type: 'input' });
    settings.api.elements.rememberPosition.checked = false;
    settings.api.elements.rememberPosition.dispatchEvent({ type: 'change' });

    assert.equal(await settings.api.saveConfiguration(), true);
    assert.equal(savedPayloads.length, 1);
    assert.equal(savedPayloads[0].name, 'カスタムマスコット');
    assert.equal(savedPayloads[0].mascot.startPosition, 'center');
    assert.equal(savedPayloads[0].mascot.size, 240);
    assert.equal(savedPayloads[0].mascot.rememberPosition, false);
  });
});

test('header full-save mirrors the footer button, busy state, and failed-save retry state', async () => {
  await withTemporaryProject(async ({ projectRoot }) => {
    let saveCount = 0;
    let finishSave;
    const settings = loadSettingsForTest({
      projectRoot,
      mascotAPI: {
        saveConfig: (config) => {
          saveCount += 1;
          return new Promise((resolve) => { finishSave = () => resolve({ ok: true, applied: true, config }); });
        },
      },
    });
    const { api, mascotAPI } = settings;
    const { headerSaveButton, saveButton, saveSelectedAction } = api.elements;

    assert.match(
      fs.readFileSync(path.join(projectRoot, 'settings.html'), 'utf8'),
      /<button id="save-button-header"[^>]*>保存して反映<\/button>\s*<span id="save-state"/,
    );
    assert.match(
      fs.readFileSync(path.join(projectRoot, 'settings.html'), 'utf8'),
      /<button id="save-button"[^>]*disabled[^>]*>保存して反映<\/button>/,
    );
    assert.notEqual(headerSaveButton, saveButton);
    assert.equal(saveSelectedAction.id, 'save-selected-action');

    await api.loadConfiguration();
    assert.equal(headerSaveButton.disabled, true);
    assert.equal(saveButton.disabled, true);

    api.elements.mascotSize.value = '240';
    api.elements.mascotSize.dispatchEvent({ type: 'input' });
    assert.equal(headerSaveButton.disabled, false);
    assert.equal(saveButton.disabled, false);

    headerSaveButton.dispatchEvent({ type: 'click' });
    assert.equal(saveCount, 1);
    assert.equal(headerSaveButton.disabled, true);
    assert.equal(saveButton.disabled, true);
    saveButton.dispatchEvent({ type: 'click' });
    assert.equal(saveCount, 1);

    finishSave();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(api.state.dirty, false);
    assert.equal(headerSaveButton.disabled, true);
    assert.equal(saveButton.disabled, true);

    api.elements.mascotSize.value = '260';
    api.elements.mascotSize.dispatchEvent({ type: 'input' });
    mascotAPI.saveConfig = async (config) => ({
      ok: true,
      applied: false,
      applyError: 'マスコットへの反映を確認できませんでした。',
      config,
    });
    assert.equal(await api.saveConfiguration(), false);
    assert.equal(headerSaveButton.disabled, false);
    assert.equal(saveButton.disabled, false);
    assert.equal(api.elements.feedback.classList.contains('is-error'), true);

    api.setBusy(true);
    assert.equal(headerSaveButton.disabled, true);
    assert.equal(saveButton.disabled, true);
    api.setBusy(false);
    assert.equal(headerSaveButton.disabled, false);
    assert.equal(saveButton.disabled, false);

    const unavailable = loadSettingsForTest({ projectRoot, provideMascotAPI: false });
    unavailable.api.setBusy(true);
    assert.equal(unavailable.api.elements.headerSaveButton.disabled, true);
    assert.equal(unavailable.api.elements.saveButton.disabled, true);
  });
});

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

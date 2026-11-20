import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadRendererForTest, loadSettingsForTest } from '../phase0/helpers/loaders.mjs';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

function makeClock() {
  let now = 0;
  let nextId = 1;
  const frames = new Map();
  const timers = new Map();
  const canceledFrames = [];
  return {
    now: () => now,
    setNow(timestamp) { now = timestamp; },
    frames,
    timers,
    canceledFrames,
    requestAnimationFrame(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      canceledFrames.push(id);
      frames.delete(id);
    },
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, deadline: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    frame(timestamp) {
      now = timestamp;
      const [id, callback] = frames.entries().next().value || [];
      if (callback) {
        frames.delete(id);
        callback(timestamp);
      }
    },
    timer(timestamp) {
      now = timestamp;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.deadline <= timestamp)
        .sort((a, b) => a[1].deadline - b[1].deadline)[0];
      if (!due) return false;
      const [id, timer] = due;
      timers.delete(id);
      timer.callback();
      return true;
    },
  };
}

function stillAction(overrides = {}) {
  return {
    _uiId: 'still',
    name: '休む',
    assetUrl: 'file:///still.svg',
    durationMs: [6000, 6000],
    movement: { type: 'still', speed: 0 },
    ...overrides,
  };
}

test('renderer schedules idle actions and still effects by deadlines, without a continuous RAF', () => {
    const clock = makeClock();
    const renderer = loadRendererForTest({
      projectRoot,
      now: clock.now,
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
      timerOverrides: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    });
    const action = stillAction({
      effect: {
        assetUrl: 'file:///trail.svg',
        intervalMs: 250,
        lifetimeMs: 1000,
        emitWhileStill: true,
      },
    });
    renderer.api.state.actions = [action];
    renderer.api.setAction(action, 0);

    assert.equal(clock.frames.size, 0);
    assert.equal(clock.timers.size, 1);
    assert.equal([...clock.timers.values()][0].deadline, 250);
    assert.equal(clock.timer(250), true);
    assert.equal(renderer.api.state.effectEntries.length, 1);
    assert.equal(renderer.api.state.lastEffectAt, 250);
    assert.equal(clock.frames.size, 0);
    assert.deepEqual(
      [...clock.timers.values()].map((timer) => timer.deadline).sort((a, b) => a - b),
      [500, 1350],
      'the next effect and its lifetime cleanup use separate timers',
    );

    renderer.api.state.paused = true;
    renderer.api.scheduleWork();
    assert.equal(clock.frames.size, 0);
    assert.deepEqual(
      [...clock.timers.values()].map((timer) => timer.deadline).sort((a, b) => a - b),
      [1000, 1350],
      'paused idle state retains one 1s safety timer and effect cleanup',
    );
});

test('renderer keeps RAF for zero-speed movement, cancels it while paused/dragging, and resumes once', () => {
    const clock = makeClock();
    const renderer = loadRendererForTest({
      projectRoot,
      now: clock.now,
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
      timerOverrides: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    });
    for (const type of ['fall', 'launch']) {
      const action = stillAction({ _uiId: type, movement: { type, speed: 0 } });
      renderer.api.setAction(action, clock.now());
      assert.equal(clock.frames.size, 1, `${type} must retain boundary updates at speed zero`);
      assert.deepEqual([...clock.timers.values()].map((timer) => timer.deadline), [1000]);
      renderer.api.state.paused = true;
      renderer.api.scheduleWork();
      assert.equal(clock.frames.size, 0, 'pause cancels automatic RAF work');
      renderer.api.state.paused = false;
      renderer.api.scheduleWork();
      assert.equal(clock.frames.size, 1, 'resume creates one RAF');
      renderer.api.state.isDragging = true;
      renderer.api.scheduleWork();
      assert.equal(clock.frames.size, 0, 'dragging cancels automatic RAF work');
      renderer.api.state.isDragging = false;
      renderer.api.cancelScheduledWork();
    }
    assert.ok(clock.canceledFrames.length >= 4);

  const reentrant = stillAction({
    _uiId: 'reentrant',
    movement: { type: 'horizontal', speed: 0 },
  });
  renderer.api.state.actions = [reentrant];
  renderer.api.setAction(reentrant, 0);
  clock.frame(7000);
  assert.equal(clock.frames.size, 1, 'setAction during a frame leaves one pending RAF');
});

test('renderer resumes overdue idle actions once after hidden, and keeps pause/drag safety timers', async () => {
  const clock = makeClock();
  const renderer = loadRendererForTest({
    projectRoot,
    now: clock.now,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
    timerOverrides: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
  });
  const first = stillAction({
    _uiId: 'first',
    durationMs: [500, 500],
    effect: {
      assetUrl: 'file:///trail.svg',
      intervalMs: 100,
      lifetimeMs: 1000,
      emitWhileStill: true,
    },
  });
  const second = stillAction({
    _uiId: 'second',
    name: '別の動作',
    durationMs: [500, 500],
    effect: first.effect,
  });
  renderer.api.state.actions = [first, second];
  renderer.api.setAction(first, 0);
  assert.equal(clock.frames.size, 0);

  renderer.context.document.hidden = true;
  renderer.context.document.dispatchEvent({ type: 'visibilitychange' });
  assert.equal(clock.timers.size, 0);
  assert.equal(renderer.api.state.effectEntries.length, 0);

  clock.setNow(7000);
  renderer.context.document.hidden = false;
  renderer.context.document.dispatchEvent({ type: 'visibilitychange' });
  assert.equal(renderer.api.state.lastFrameAt, 7000);
  assert.equal(clock.frames.size, 0);
  assert.equal(clock.timer(7000), true);
  assert.ok(renderer.api.state.nextActionAt > 7000, 'only one overdue action is selected on resume');
  assert.equal(renderer.api.state.effectEntries.length, 1, 'overdue still effects emit at most once on wake');
  assert.equal(clock.timer(7000), false, 'resume does not create a zero-delay loop');

  await renderer.dispatchCommand({ command: 'set-paused', value: true });
  assert.equal(clock.frames.size, 0);
  assert.equal(clock.timers.size, 1, 'pause keeps only the safety timer after clearing effects');
  await renderer.dispatchCommand({ command: 'set-paused', value: false });
  assert.equal(clock.frames.size, 0);
  assert.equal(clock.timers.size, 1);
});

test('renderer resets the first moving-frame delta when an idle action timer selects movement', () => {
  const clock = makeClock();
  const renderer = loadRendererForTest({
    projectRoot,
    random: () => 0.1,
    now: clock.now,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
    timerOverrides: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
  });
  renderer.api.state.config = { mascot: { size: 100, margin: 40 } };
  renderer.api.state.position = { x: 100, y: 100 };
  const idle = stillAction({ durationMs: [2000, 2000] });
  const moving = stillAction({
    _uiId: 'moving',
    durationMs: [6000, 6000],
    movement: { type: 'horizontal', speed: 300 },
  });
  renderer.api.state.actions = [moving];
  renderer.api.setAction(idle, 0);

  assert.equal(clock.timer(1000), true);
  assert.equal(clock.timer(2000), true);
  assert.equal(renderer.api.state.currentAction, moving);
  assert.equal(renderer.api.state.lastFrameAt, 2000);
  clock.frame(2016);

  assert.ok(Math.abs(renderer.api.state.position.x - 95.2) < 0.001);
});

test('renderer uses rendered-value caches despite CSS transform serialization and preserves hit testing', () => {
    const renderer = loadRendererForTest({ projectRoot });
    const mascot = renderer.nodes.get('mascot');
    const image = renderer.nodes.get('mascot-image');
    const writes = { width: 0, height: 0, transform: 0, flip: 0 };
    const reads = { width: 0, height: 0, transform: 0 };
    let normalizedTransform = '';
    for (const key of ['width', 'height', 'transform']) {
      let value = '';
      Object.defineProperty(mascot.style, key, {
        get() { reads[key] += 1; return value; },
        set(next) {
          writes[key] += 1;
          value = key === 'transform' ? next.replace(/, 0\)$/, ', 0px)') : next;
          if (key === 'transform') normalizedTransform = value;
        },
        configurable: true,
      });
    }
    image.style.setProperty = (name, value) => {
      if (name === '--image-flip-x') writes.flip += 1;
      image.style[name] = value;
    };
    renderer.api.state.config = { mascot: { size: 120 } };
    renderer.api.state.position = { x: 30, y: 40 };
    renderer.api.renderPosition();
    renderer.api.renderPosition();
    renderer.api.renderMascotSize();
    renderer.api.renderMascotSize();
    renderer.api.applyFlip();
    renderer.api.applyFlip();

    assert.deepEqual(writes, { width: 1, height: 1, transform: 1, flip: 1 });
    assert.deepEqual(reads, { width: 0, height: 0, transform: 0 });
    assert.equal(normalizedTransform, 'translate3d(30px, 40px, 0px)');
    assert.equal(renderer.api.state.position.x, 30);
    assert.equal(renderer.api.pointIsInsideMascot(30, 40), true);
});

test('renderer invalidates rendered-style caches on successful configuration reload', async () => {
  class LoadedImage {
    constructor() {
      this.naturalWidth = 1;
      this.naturalHeight = 1;
    }

    set src(_value) { queueMicrotask(() => this.onload?.()); }
  }
  const renderer = loadRendererForTest({
    projectRoot,
    ImageClass: LoadedImage,
    localStorage: { getItem: () => JSON.stringify({ x: 30, y: 40 }), setItem() {} },
    mascotAPI: {
      loadConfig: async () => ({
        config: {
          name: 'cache reload',
          mascot: { size: 120, startPosition: 'center', margin: 40, rememberPosition: true },
          actions: [{
            name: 'still', file: 'actions/still.svg', weight: 1, durationMs: [6000, 6000],
            movement: { type: 'still', speed: 0 },
          }],
        },
      }),
      resolveAsset: async () => 'file:///still.svg',
    },
  });
  const mascot = renderer.nodes.get('mascot');
  const image = renderer.nodes.get('mascot-image');
  mascot.style.width = '';
  mascot.style.height = '';
  mascot.style.transform = '';
  image.complete = true;
  image.naturalWidth = 1;
  renderer.api.state.config = { mascot: { size: 120 } };
  renderer.api.state.position = { x: 30, y: 40 };
  const writes = { width: 0, height: 0, transform: 0, flip: 0 };
  for (const key of ['width', 'height', 'transform']) {
    let value = '';
    Object.defineProperty(mascot.style, key, {
      get: () => value,
      set(next) { writes[key] += 1; value = next; },
      configurable: true,
    });
  }
  image.style.setProperty = (name, value) => {
    if (name === '--image-flip-x') writes.flip += 1;
    image.style[name] = value;
  };
  renderer.api.renderPosition();
  renderer.api.renderMascotSize();
  renderer.api.applyFlip();
  const result = await renderer.api.reloadConfig({ keepPosition: true });

  assert.equal(result.ok, true);
  assert.equal(renderer.api.state.position.x, 30);
  assert.equal(renderer.api.state.position.y, 40);
  assert.deepEqual(writes, { width: 2, height: 2, transform: 2, flip: 2 });
});

test('settings speed preview reads stage width once per start, then moves its wrapper without layout reads', () => {
    const clock = makeClock();
    const settings = loadSettingsForTest({
      projectRoot,
      now: clock.now,
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
    });
    const action = {
      ...stillAction({ _uiId: 'move', movement: { type: 'horizontal', speed: 80 } }),
      _assetUrl: 'file:///move.svg',
      flipMode: 'direction',
    };
    settings.api.state.actions = [action];
    settings.api.state.selectedId = action._uiId;
    let reads = 0;
    settings.api.elements.movementSpeedPreviewStage.getBoundingClientRect = () => {
      reads += 1;
      return { left: 0, top: 0, width: 420, height: 112, right: 420, bottom: 112 };
    };
    settings.api.elements.movementSpeed.value = '90';
    settings.api.elements.movementSpeed.dispatchEvent({ type: 'input' });
    assert.equal(reads, 1);
    clock.frame(0);
    for (let frame = 1; frame <= 10; frame += 1) clock.frame(frame * 50);
    assert.equal(reads, 1);
    assert.equal(settings.api.elements.movementSpeedPreviewImage.style.left || '', '');
    assert.equal(settings.api.elements.movementSpeedPreviewWrapper.style.transform, 'translate3d(45px, -50%, 0)');

    settings.api.elements.movementSpeedPreviewStage.getBoundingClientRect = () => {
      reads += 1;
      return { left: 0, top: 0, width: 500, height: 112, right: 500, bottom: 112 };
    };
    settings.window.dispatch('resize');
    assert.equal(reads, 2);
    assert.equal(settings.api.movementPreviewState().stageWidth, 500);
});

test('settings preview coalesces geometry work and retains source and card identity', () => {
    const clock = makeClock();
    const settings = loadSettingsForTest({
      projectRoot,
      now: clock.now,
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
    });
    const image = settings.api.elements.actionPreview;
    let sourceWrites = 0;
    let removals = 0;
    let source = '';
    Object.defineProperty(image, 'src', {
      get: () => source,
      set(value) { sourceWrites += 1; source = value; },
      configurable: true,
    });
    image.removeAttribute = (name) => {
      assert.equal(name, 'src');
      removals += 1;
    };
    const placeholder = settings.api.elements.actionPlaceholder;
    settings.api.setImagePreview(image, placeholder, 'file:///same.gif');
    settings.api.setImagePreview(image, placeholder, 'file:///same.gif');
    assert.equal(sourceWrites, 1);
    image.dispatchEvent({ type: 'error' });
    assert.equal(sourceWrites, 1, 'handling an error must not immediately retry the failed source');
    settings.api.setImagePreview(image, placeholder, 'file:///same.gif');
    assert.equal(sourceWrites, 2, 'an intentional rerender can retry the failed source');
    settings.api.setImagePreview(image, placeholder, 'file:///new.gif');
    assert.equal(sourceWrites, 3);
    settings.api.setImagePreview(image, placeholder, '');
    assert.equal(removals, 1);
    assert.equal(image.hidden, true);
    assert.equal(placeholder.hidden, false);

    const oldAction = {
      _uiId: 'same-id', name: '古い名前', weight: 1, movement: { type: 'still', speed: 0 },
      imageTransform: { scale: 1, offsetX: 0, offsetY: 0, flipX: false },
    };
    settings.api.state.actions = [oldAction];
    settings.api.state.selectedId = oldAction._uiId;
    settings.api.renderActionList();
    const card = settings.api.actionCardViews.get(oldAction._uiId);
    const latestAction = {
      ...oldAction, name: '新しい名前', weight: 2, movement: { type: 'horizontal', speed: 50 },
    };
    settings.api.state.actions = [latestAction];
    settings.api.updateActionCard(latestAction);
    assert.equal(settings.api.actionCardViews.get(latestAction._uiId).card, card.card);
    card.button.dispatchEvent({ type: 'click' });
    assert.equal(settings.api.elements.actionName.value, '新しい名前');
    card.weightInput.value = '7';
    card.weightInput.dispatchEvent({ type: 'change', stopPropagation() {} });
    assert.equal(latestAction.weight, 7);
    assert.equal(oldAction.weight, 1);

    settings.api.queuePreviewGeometry();
    settings.api.queuePreviewGeometry();
    image.dispatchEvent({ type: 'load' });
    settings.api.elements.effectLiveImage.dispatchEvent({ type: 'error' });
    assert.equal(clock.frames.size, 1, 'trailing image/layout updates share one pending frame');
    clock.frame(0);
    assert.equal(clock.frames.size, 0);

    const actualStage = settings.api.elements.actualSizeScene;
    actualStage.getBoundingClientRect = () => {
      throw new Error('100% preview does not need available-capacity measurements');
    };
    settings.api.renderPreviewScene(
      {
        action: {
          ...latestAction,
          _assetUrl: 'file:///actual.svg',
          imageTransform: { scale: 1, offsetX: 0, offsetY: 0, flipX: false },
        },
        size: 100,
      },
      {
        stage: actualStage,
        mascot: settings.api.elements.actualSizeMascot,
        image: settings.api.elements.actualSizeImage,
        effect: settings.api.elements.actualSizeEffect,
        label: settings.api.elements.actualSizeScale,
      },
      true,
    );
    assert.equal(actualStage.style.width, '100px');
    settings.window.dispatch('beforeunload');
    assert.equal((settings.window._listeners.get('resize') || []).length, 0);
});

const stage = document.getElementById('stage');
const mascotElement = document.getElementById('mascot');
const mascotImage = document.getElementById('mascot-image');
const statusElement = document.getElementById('status');
const SAFE_EDGE_INSET = 12;
const IMAGE_DECODE_CONCURRENCY = 4;
const MAX_EFFECTS = 100;
const DEFAULT_DURATION_MS = window.DesktopMascotConfigRules.DEFAULT_DURATION_MS;
const mapWithConcurrency = window.DesktopMascotConcurrency.mapWithConcurrency;
const failedActionIds = new Set();

const state = {
  config: null,
  actions: [],
  currentAction: null,
  position: { x: 40, y: 40 },
  velocity: { x: 0, y: 0 },
  isDragging: false,
  dragPointerId: null,
  dragOffset: { x: 0, y: 0 },
  paused: false,
  nextActionAt: 0,
  lastFrameAt: performance.now(),
  lastEffectAt: 0,
  passthrough: true,
  randomFlip: 1,
  facing: 1,
  directionalFlip: 1,
  reloadGeneration: 0,
  lastVisibilityCheckAt: 0,
  pointerPosition: null,
  effectEntries: [],
};

function showStatus(message) {
  statusElement.textContent = message;
  statusElement.hidden = false;
}

function clearStatus() {
  statusElement.hidden = true;
  statusElement.textContent = '';
}

function randomBetween(min, max) {
  return min + Math.random() * Math.max(0, max - min);
}

function durationFor(action) {
  const value = action.durationMs;
  if (Array.isArray(value) && value.length >= 2) {
    return randomBetween(Number(value[0]) || DEFAULT_DURATION_MS[0], Number(value[1]) || DEFAULT_DURATION_MS[1]);
  }
  return Number(value) || DEFAULT_DURATION_MS[0];
}

function chooseWeightedAction() {
  const candidates = state.actions.filter((action) => !failedActionIds.has(action._uiId));
  if (candidates.length === 0) return null;
  const total = candidates.reduce((sum, action) => sum + Math.max(1, Number(action.weight) || 1), 0);
  let cursor = Math.random() * total;

  for (const action of candidates) {
    cursor -= Math.max(1, Number(action.weight) || 1);
    if (cursor <= 0) return action;
  }

  return candidates[candidates.length - 1];
}

function configuredMascotSize() {
  const size = Number(state.config?.mascot?.size);
  return Number.isFinite(size) && size > 0 ? size : 180;
}

function maximumMascotSize() {
  const viewportWidth = Number(window.innerWidth);
  const viewportHeight = Number(window.innerHeight);
  const availableWidth = Math.max(
    1,
    (Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1) - SAFE_EDGE_INSET * 2,
  );
  const availableHeight = Math.max(
    1,
    (Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 1) - SAFE_EDGE_INSET * 2,
  );
  return Math.min(availableWidth, availableHeight);
}

function getMascotWidth() {
  return Math.min(configuredMascotSize(), maximumMascotSize());
}

function getMascotHeight() {
  return getMascotWidth();
}

function renderMascotSize() {
  const size = getMascotWidth();
  mascotElement.style.width = `${size}px`;
  mascotElement.style.height = `${size}px`;
}

function configuredMargin() {
  const margin = Number(state.config?.mascot?.margin);
  return Number.isFinite(margin) ? Math.max(0, margin) : 40;
}

function axisMovementBounds(viewportSize, mascotSize) {
  const numericViewport = Number(viewportSize);
  const viewport = Number.isFinite(numericViewport) && numericViewport > 0 ? numericViewport : 1;
  const sprite = Math.max(1, Number(mascotSize) || 1);
  if (viewport <= sprite) {
    const centered = (viewport - sprite) / 2;
    return { minimum: centered, maximum: centered };
  }

  const inset = Math.min(SAFE_EDGE_INSET, Math.max(0, (viewport - sprite) / 2));
  return {
    minimum: inset,
    maximum: viewport - sprite - inset,
  };
}

function movementBounds() {
  const horizontal = axisMovementBounds(window.innerWidth, getMascotWidth());
  const vertical = axisMovementBounds(window.innerHeight, getMascotHeight());
  return {
    minX: horizontal.minimum,
    maxX: horizontal.maximum,
    minY: vertical.minimum,
    maxY: vertical.maximum,
  };
}

function clampPosition(x, y) {
  const { minX, maxX, minY, maxY } = movementBounds();
  const numericX = Number(x);
  const numericY = Number(y);
  const safeX = Number.isFinite(numericX) ? numericX : (minX + maxX) / 2;
  const safeY = Number.isFinite(numericY) ? numericY : (minY + maxY) / 2;
  return {
    x: Math.min(maxX, Math.max(minX, safeX)),
    y: Math.min(maxY, Math.max(minY, safeY)),
  };
}

function renderPosition() {
  mascotElement.style.left = '';
  mascotElement.style.top = '';
  mascotElement.style.transform = `translate3d(${state.position.x}px, ${state.position.y}px, 0)`;
}

function savePosition() {
  if (state.config?.mascot?.rememberPosition === false) return;
  try {
    localStorage.setItem('desktop-mascot-position-v1', JSON.stringify(state.position));
  } catch (error) {
    console.warn('マスコットの位置を保存できませんでした。', error);
  }
}

function loadSavedPosition() {
  if (state.config?.mascot?.rememberPosition === false) return null;
  try {
    const position = JSON.parse(localStorage.getItem('desktop-mascot-position-v1'));
    if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) return position;
  } catch (_error) {
    return null;
  }
  return null;
}

function ensureMascotVisible({ save = false } = {}) {
  renderMascotSize();
  const current = state.position || {};
  const next = clampPosition(current.x, current.y);
  const changed = next.x !== current.x || next.y !== current.y;
  state.position = next;
  renderPosition();
  if (save && changed) savePosition();
  return changed;
}

function configuredStartPosition() {
  const mascotConfig = state.config?.mascot ?? {};
  const margin = configuredMargin();
  const width = getMascotWidth();
  const height = getMascotHeight();

  switch (mascotConfig.startPosition) {
    case 'top-left':
      return { x: margin, y: margin };
    case 'top-right':
      return { x: window.innerWidth - width - margin, y: margin };
    case 'bottom-left':
      return { x: margin, y: window.innerHeight - height - margin };
    case 'center':
      return { x: (window.innerWidth - width) / 2, y: (window.innerHeight - height) / 2 };
    case 'bottom-right':
    default:
      return {
        x: window.innerWidth - width - margin,
        y: window.innerHeight - height - margin,
      };
  }
}

function setMousePassthrough(ignore) {
  if (state.passthrough === ignore) return;
  state.passthrough = ignore;
  window.mascotAPI.setMousePassthrough(ignore);
}

function pointIsInsideMascot(x, y) {
  const size = getMascotWidth();
  return x >= state.position.x && x <= state.position.x + size
    && y >= state.position.y && y <= state.position.y + size;
}

function refreshPointerPassthrough() {
  if (state.isDragging || !state.pointerPosition) return;
  setMousePassthrough(!pointIsInsideMascot(
    state.pointerPosition.x,
    state.pointerPosition.y,
  ));
}

function removeEffectEntry(entry) {
  if (!entry) return;
  const index = state.effectEntries.indexOf(entry);
  if (index >= 0) state.effectEntries.splice(index, 1);
  if (entry.timer != null) window.clearTimeout(entry.timer);
  entry.timer = null;
  entry.element?.remove();
}

function clearEffects() {
  for (const entry of [...state.effectEntries]) removeEffectEntry(entry);
  state.lastEffectAt = 0;
}

function createEffect() {
  const effect = state.currentAction?.effect;
  if (!effect?.assetUrl) return;

  while (state.effectEntries.length >= MAX_EFFECTS) {
    removeEffectEntry(state.effectEntries[0]);
  }

  const effectElement = document.createElement('img');
  const size = Number(effect.size) || 32;
  const lifetimeMs = Number(effect.lifetimeMs) || 1800;
  const mascotHeight = getMascotHeight();

  effectElement.className = 'trail-effect';
  effectElement.src = effect.assetUrl;
  effectElement.alt = '';
  effectElement.style.width = `${size}px`;
  effectElement.style.left = `${
    state.position.x
    + getMascotWidth() / 2
    + (Number(effect.offsetX) || 0) * state.directionalFlip
  }px`;
  effectElement.style.top = `${
    state.position.y + mascotHeight - (Number(effect.offsetY) || 0)
  }px`;
  effectElement.style.setProperty('--effect-life', `${lifetimeMs}ms`);
  stage.appendChild(effectElement);
  const entry = { element: effectElement, timer: null };
  state.effectEntries.push(entry);
  entry.timer = window.setTimeout(() => removeEffectEntry(entry), lifetimeMs + 100);
  return entry;
}

function maybeCreateEffect(now) {
  const effect = state.currentAction?.effect;
  if (!effect?.assetUrl) return;

  const intervalMs = Number(effect.intervalMs) || 450;
  if (now - state.lastEffectAt >= intervalMs) {
    state.lastEffectAt = now;
    createEffect();
  }
}

function setPosition(x, y, { emitEffect = false, now = performance.now() } = {}) {
  const previous = state.position;
  const next = clampPosition(x, y);
  const distance = Math.hypot(next.x - previous.x, next.y - previous.y);

  state.position = next;
  renderPosition();
  refreshPointerPassthrough();

  if (emitEffect && distance > 0.5) {
    maybeCreateEffect(now);
  }
}

function randomX() {
  const { minX, maxX } = movementBounds();
  return randomBetween(minX, maxX);
}

function applyActionImageTransform(action) {
  const transform = action?.imageTransform || {};
  const flipX = transform.flipX === true ? -1 : 1;
  const scale = Math.min(3, Math.max(0.3, Number(transform.scale) || 1));
  const offsetX = Math.min(100, Math.max(-100, Number(transform.offsetX) || 0));
  const offsetY = Math.min(100, Math.max(-100, Number(transform.offsetY) || 0));
  mascotImage.style.setProperty('--image-base-flip-x', String(flipX));
  mascotImage.style.setProperty('--image-scale', String(scale));
  mascotImage.style.setProperty('--image-offset-x', `${offsetX}%`);
  mascotImage.style.setProperty('--image-offset-y', `${offsetY}%`);
}

function applyFlip() {
  const mode = state.currentAction?.flipMode || 'direction';
  let flip = 1;

  if (mode === 'random') {
    flip = state.randomFlip;
  } else if (mode === 'direction') {
    if (state.velocity.x < 0) state.facing = -1;
    else if (state.velocity.x > 0) state.facing = 1;
    flip = state.facing;
  }

  state.directionalFlip = flip;
  mascotImage.style.setProperty('--image-flip-x', String(flip));
}

function orthogonalVelocity(speed) {
  const direction = Math.random() < 0.5 ? -1 : 1;
  return Math.random() < 0.5
    ? { x: direction * speed, y: 0 }
    : { x: 0, y: direction * speed };
}

function launchVelocity(speed) {
  return {
    x: randomBetween(-speed * 0.3, speed * 0.3),
    y: -speed,
  };
}

function setAction(action, now = performance.now()) {
  if (!action) return;

  state.currentAction = action;
  state.lastEffectAt = 0;
  state.nextActionAt = now + durationFor(action);
  state.randomFlip = Math.random() < 0.5 ? -1 : 1;
  mascotImage.src = action.assetUrl;
  mascotElement.setAttribute('aria-label', `${state.config?.name || 'マスコット'}：${action.name || '動作'}`);
  applyActionImageTransform(action);

  const movement = action.movement ?? { type: 'still' };
  const speed = Math.max(0, Number(movement.speed) || 0);
  const { minY, maxY } = movementBounds();

  if (movement.type === 'horizontal') {
    const direction = Math.random() < 0.5 ? -1 : 1;
    state.velocity = { x: direction * speed, y: 0 };
    const margin = configuredMargin();
    setPosition(state.position.x, Math.max(minY, maxY - margin));
  } else if (movement.type === 'wander') {
    const angle = Math.random() * Math.PI * 2;
    state.velocity = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
  } else if (movement.type === 'fall') {
    state.velocity = { x: 0, y: speed };
    setPosition(randomX(), minY);
  } else if (movement.type === 'launch') {
    state.velocity = launchVelocity(speed);
    setPosition(randomX(), maxY);
  } else if (movement.type === 'orthogonal') {
    state.velocity = orthogonalVelocity(speed);
  } else {
    state.velocity = { x: 0, y: 0 };
  }

  applyFlip();
}

function displayAction(action, now = performance.now(), timeoutMs = 6000) {
  if (!action) return Promise.reject(new Error('表示する動作がありません。'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      mascotImage.removeEventListener('load', onLoad);
      mascotImage.removeEventListener('error', onError);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onLoad = () => {
      setPosition(state.position.x, state.position.y);
      finish(resolve);
    };
    const onError = () => finish(
      reject,
      new Error(`「${action.name || '動作'}」の画像を実際のマスコット画面へ表示できません。`),
    );
    const timer = window.setTimeout(() => finish(
      reject,
      new Error(`「${action.name || '動作'}」の実表示確認がタイムアウトしました。`),
    ), timeoutMs);

    mascotImage.addEventListener('load', onLoad);
    mascotImage.addEventListener('error', onError);
    setAction(action, now);
    if (mascotImage.complete && mascotImage.naturalWidth > 0) {
      Promise.resolve().then(onLoad);
    }
  });
}

function verifyImageAsset(assetUrl, label) {
  const maxImagePixels = 16_000_000;
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      reject(new Error(`「${label}」の画像読み込みがタイムアウトしました。`));
    }, 6000);

    image.onload = () => {
      window.clearTimeout(timer);
      if (image.naturalWidth * image.naturalHeight > maxImagePixels) {
        reject(new Error(`「${label}」の画像は16MP以下にしてください。`));
        return;
      }
      resolve();
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`「${label}」の画像を表示できません。`));
    };
    image.src = assetUrl;
  });
}

async function resolveAction(action) {
  const assetUrl = await window.mascotAPI.resolveAsset(action.file);
  if (!assetUrl) throw new Error(`「${action.name || '動作'}」の画像が見つかりません。`);
  await verifyImageAsset(assetUrl, action.name || '動作');

  let effect = null;
  if (action.effect?.file) {
    const effectAssetUrl = await window.mascotAPI.resolveAsset(action.effect.file);
    if (!effectAssetUrl) throw new Error(`「${action.name || '動作'}」のエフェクト画像が見つかりません。`);
    await verifyImageAsset(effectAssetUrl, `${action.name || '動作'}のエフェクト`);
    effect = { ...action.effect, assetUrl: effectAssetUrl };
  }

  return { ...action, assetUrl, effect };
}

async function reloadConfig({
  keepPosition = true,
  preferredActionIndex = null,
  expectedConfigHash = null,
} = {}) {
  const reloadGeneration = ++state.reloadGeneration;
  try {
    const { config, configHash } = await window.mascotAPI.loadConfig();
    if (!config || !Array.isArray(config.actions) || config.actions.length === 0) {
      throw new Error('config.json の actions が空です。');
    }
    if (expectedConfigHash && configHash !== expectedConfigHash) {
      throw new Error('保存直後とは異なる設定を読み込んだため、反映を中止しました。');
    }

    clearEffects();
    const resolvedActions = await mapWithConcurrency(
      config.actions,
      IMAGE_DECODE_CONCURRENCY,
      resolveAction,
    );
    if (reloadGeneration !== state.reloadGeneration) {
      return { ok: false, superseded: true, error: 'より新しい設定の読み込みを優先しました。' };
    }

    failedActionIds.clear();
    state.config = config;
    state.actions = resolvedActions;
    renderMascotSize();

    const preserved = keepPosition && state.currentAction ? state.position : null;
    const saved = loadSavedPosition();
    state.position = clampPosition(
      preserved?.x ?? saved?.x ?? configuredStartPosition().x,
      preserved?.y ?? saved?.y ?? configuredStartPosition().y,
    );
    renderPosition();

    const preferredAction = Number.isInteger(preferredActionIndex)
      && preferredActionIndex >= 0
      && preferredActionIndex < resolvedActions.length
      ? resolvedActions[preferredActionIndex]
      : null;
    const nextAction = preferredAction || chooseWeightedAction();
    await displayAction(nextAction);
    if (reloadGeneration !== state.reloadGeneration) {
      return { ok: false, superseded: true, error: 'より新しい設定の読み込みを優先しました。' };
    }
    clearStatus();
    return {
      ok: true,
      appliedHash: configHash || null,
      actionName: nextAction?.name || null,
      actionIndex: resolvedActions.indexOf(nextAction),
    };
  } catch (error) {
    const message = error?.message || String(error);
    if (reloadGeneration !== state.reloadGeneration) {
      return { ok: false, superseded: true, error: 'より新しい設定の読み込みを優先しました。' };
    }
    console.error(error);
    showStatus(`設定を読み込めませんでした：${message}`);
    return { ok: false, error: message };
  }
}

function updateMotion(now, deltaSeconds) {
  if (state.paused || state.isDragging || !state.currentAction) return;

  if (now >= state.nextActionAt) {
    setAction(chooseWeightedAction(), now);
  }

  const movementType = state.currentAction.movement?.type || 'still';
  if (movementType === 'still') {
    if (state.currentAction.effect?.emitWhileStill) maybeCreateEffect(now);
    return;
  }

  let nextX = state.position.x + state.velocity.x * deltaSeconds;
  let nextY = state.position.y + state.velocity.y * deltaSeconds;
  const { minX, maxX, minY, maxY } = movementBounds();
  const speed = Math.max(0, Number(state.currentAction.movement?.speed) || 0);

  if (movementType === 'fall') {
    if (nextY >= maxY) {
      nextX = randomX();
      nextY = minY;
    }
    applyFlip();
    setPosition(nextX, nextY, { emitEffect: true, now });
    return;
  }

  if (movementType === 'launch') {
    if (nextX <= minX || nextX >= maxX) {
      state.velocity.x *= -1;
      nextX = Math.min(maxX, Math.max(minX, nextX));
    }
    if (nextY <= minY) {
      nextX = randomX();
      nextY = maxY;
      state.velocity = launchVelocity(speed);
    }
    applyFlip();
    setPosition(nextX, nextY, { emitEffect: true, now });
    return;
  }

  if (movementType === 'orthogonal') {
    if (state.velocity.x !== 0 && (nextX <= minX || nextX >= maxX)) {
      nextX = Math.min(maxX, Math.max(minX, nextX));
      state.velocity = { x: 0, y: (Math.random() < 0.5 ? -1 : 1) * speed };
    } else if (state.velocity.y !== 0 && (nextY <= minY || nextY >= maxY)) {
      nextY = Math.min(maxY, Math.max(minY, nextY));
      state.velocity = { x: (Math.random() < 0.5 ? -1 : 1) * speed, y: 0 };
    }
    applyFlip();
    setPosition(nextX, nextY, { emitEffect: true, now });
    return;
  }

  if (nextX <= minX || nextX >= maxX) {
    state.velocity.x *= -1;
    nextX = Math.min(maxX, Math.max(minX, nextX));
  }
  if (nextY <= minY || nextY >= maxY) {
    state.velocity.y *= -1;
    nextY = Math.min(maxY, Math.max(minY, nextY));
  }

  applyFlip();
  setPosition(nextX, nextY, { emitEffect: true, now });
}

function animationFrame(now) {
  const deltaSeconds = Math.min(0.05, Math.max(0, (now - state.lastFrameAt) / 1000));
  state.lastFrameAt = now;
  updateMotion(now, deltaSeconds);
  if (now - state.lastVisibilityCheckAt >= 1000) {
    state.lastVisibilityCheckAt = now;
    ensureMascotVisible();
  }
  requestAnimationFrame(animationFrame);
}

mascotElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  state.pointerPosition = { x: event.clientX, y: event.clientY };
  state.isDragging = true;
  state.dragPointerId = event.pointerId;
  state.dragOffset = {
    x: event.clientX - state.position.x,
    y: event.clientY - state.position.y,
  };
  mascotElement.classList.add('is-dragging');
  mascotElement.setPointerCapture(event.pointerId);
  setMousePassthrough(false);
});

window.addEventListener('pointermove', (event) => {
  state.pointerPosition = { x: event.clientX, y: event.clientY };
  if (state.isDragging && event.pointerId === state.dragPointerId) {
    setPosition(
      event.clientX - state.dragOffset.x,
      event.clientY - state.dragOffset.y,
      { emitEffect: true },
    );
    return;
  }

  setMousePassthrough(!pointIsInsideMascot(event.clientX, event.clientY));
});

function finishDrag(event) {
  if (!state.isDragging) return;
  if (event?.pointerId != null && event.pointerId !== state.dragPointerId) return;

  try {
    if (mascotElement.hasPointerCapture(state.dragPointerId)) {
      mascotElement.releasePointerCapture(state.dragPointerId);
    }
  } catch (_error) {
    // Pointer capture may already have been released by the browser.
  }

  state.isDragging = false;
  state.dragPointerId = null;
  mascotElement.classList.remove('is-dragging');
  savePosition();

  const x = event?.clientX ?? -1;
  const y = event?.clientY ?? -1;
  setMousePassthrough(!pointIsInsideMascot(x, y));
}

window.addEventListener('pointerup', finishDrag);
window.addEventListener('pointercancel', finishDrag);
document.documentElement.addEventListener('mouseleave', () => {
  if (!state.isDragging) {
    state.pointerPosition = null;
    setMousePassthrough(true);
  }
});
window.addEventListener('resize', () => {
  window.requestAnimationFrame(() => ensureMascotVisible({ save: true }));
});
window.addEventListener('pageshow', () => ensureMascotVisible({ save: true }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearEffects();
  else ensureMascotVisible({ save: true });
});
window.addEventListener('beforeunload', () => {
  clearEffects();
  savePosition();
});

mascotElement.addEventListener('mouseenter', () => setMousePassthrough(false));
mascotElement.addEventListener('mouseleave', (event) => {
  if (!state.isDragging) {
    setMousePassthrough(!pointIsInsideMascot(event.clientX, event.clientY));
  }
});
function handleMascotImageError() {
  if (state.currentAction) failedActionIds.add(state.currentAction._uiId);
  window.mascotAPI.reportDiagnostic?.('image-load-failed');
  showStatus('画像を表示できません。🪼メニューから画像・設定フォルダを確認してください。');
  const nextAction = chooseWeightedAction();
  if (nextAction) setAction(nextAction);
}

mascotImage.addEventListener('load', () => {
  if (state.currentAction) failedActionIds.delete(state.currentAction._uiId);
  clearStatus();
  setPosition(state.position.x, state.position.y);
});
mascotImage.addEventListener('error', handleMascotImageError);

window.mascotAPI.onCommand(async ({ command, value }) => {
  if (command === 'set-paused') {
    state.paused = Boolean(value);
    if (state.paused) clearEffects();
    if (!state.paused && state.currentAction) {
      state.nextActionAt = performance.now() + durationFor(state.currentAction);
    }
  }
  if (command === 'center') {
    setPosition(
      (window.innerWidth - getMascotWidth()) / 2,
      (window.innerHeight - getMascotHeight()) / 2,
    );
    savePosition();
  }
  if (command === 'ensure-visible') {
    ensureMascotVisible({ save: true });
  }
  if (command === 'sync-pointer-position') {
    const x = Number(value?.x);
    const y = Number(value?.y);
    if (Number.isFinite(x) && Number.isFinite(y) && !state.isDragging) {
      state.pointerPosition = { x, y };
      setMousePassthrough(!pointIsInsideMascot(x, y));
    }
  }
  if (command === 'reload-config') {
    const requestId = value?.requestId ? String(value.requestId) : null;
    const preferredActionIndex = Number.isInteger(value?.previewActionIndex)
      ? value.previewActionIndex
      : null;
    const expectedConfigHash = typeof value?.configHash === 'string' ? value.configHash : null;
    const result = await reloadConfig({
      keepPosition: true,
      preferredActionIndex,
      expectedConfigHash,
    });
    if (requestId) {
      window.mascotAPI.reportApplyResult?.({ requestId, ...result });
    }
  }
});

window.addEventListener('error', () => window.mascotAPI.reportDiagnostic?.('window-error'));
window.addEventListener(
  'unhandledrejection',
  () => window.mascotAPI.reportDiagnostic?.('unhandled-rejection'),
);

reloadConfig({ keepPosition: false }).then(() => {
  requestAnimationFrame(animationFrame);
});

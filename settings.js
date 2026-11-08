const REQUIRED_MASCOT_API_METHODS = Object.freeze([
  'loadConfig',
  'recoverConfig',
  'reportDirtyState',
  'resolveAsset',
  'getAssetMetadata',
  'chooseImage',
  'importImage',
  'saveTransparentPng',
  'getPathForFile',
  'getAppInfo',
  'prepareDistributionDefaults',
  'saveConfig',
]);

const sharedRules = window.DesktopMascotConfigRules;
const SETTINGS_RULES = sharedRules?.CONFIG_RULES;
const DEFAULT_DURATION_MS = sharedRules?.DEFAULT_DURATION_MS;
const MAX_ACTIONS = SETTINGS_RULES?.actionCount.maximum;
const ALLOWED_MOVEMENTS = new Set(sharedRules?.ALLOWED_MOVEMENTS || []);
const ALLOWED_FLIPS = new Set(sharedRules?.ALLOWED_FLIP_MODES || []);
const ALLOWED_START_POSITIONS = new Set(sharedRules?.ALLOWED_START_POSITIONS || []);
const mapWithConcurrency = window.DesktopMascotConcurrency?.mapWithConcurrency;

const desktopApiAvailable = Boolean(
  sharedRules?.CONFIG_RULES
  && typeof mapWithConcurrency === 'function'
  && window.mascotAPI
  && REQUIRED_MASCOT_API_METHODS.every((method) => typeof window.mascotAPI[method] === 'function'),
);

const elements = {
  saveState: document.getElementById('save-state'),
  feedback: document.getElementById('feedback'),
  toast: document.getElementById('toast'),
  recoveryPanel: document.getElementById('recovery-panel'),
  recoveryMessage: document.getElementById('recovery-message'),
  recoveryBackup: document.getElementById('recovery-backup'),
  recoveryDefaults: document.getElementById('recovery-defaults'),
  mascotName: document.getElementById('mascot-name'),
  mascotSize: document.getElementById('mascot-size'),
  mascotSizeOutput: document.getElementById('mascot-size-output'),
  startPosition: document.getElementById('start-position'),
  rememberPosition: document.getElementById('remember-position'),
  addAction: document.getElementById('add-action'),
  actionList: document.getElementById('action-list'),
  openSizeManager: document.getElementById('open-size-manager'),
  openDurationBulk: document.getElementById('open-duration-bulk'),
  emptyState: document.getElementById('empty-state'),
  actionEditor: document.getElementById('action-editor'),
  actionPreviewFrame: document.getElementById('action-preview-frame'),
  moveUp: document.getElementById('move-up'),
  moveDown: document.getElementById('move-down'),
  deleteAction: document.getElementById('delete-action'),
  actionDropzone: document.getElementById('action-dropzone'),
  actionPreview: document.getElementById('action-preview'),
  actionClippingStatus: document.getElementById('action-clipping-status'),
  actionFitInFrame: document.getElementById('action-fit-in-frame'),
  actionPlaceholder: document.getElementById('action-placeholder'),
  imageEditButton: document.getElementById('image-edit-button'),
  actionName: document.getElementById('action-name'),
  actionWeight: document.getElementById('action-weight'),
  flipDirection: document.getElementById('flip-direction'),
  imageFlipX: document.getElementById('image-flip-x'),
  durationMin: document.getElementById('duration-min'),
  durationMax: document.getElementById('duration-max'),
  movementType: document.getElementById('movement-type'),
  movementSpeed: document.getElementById('movement-speed'),
  speedOutput: document.getElementById('speed-output'),
  effectEnabled: document.getElementById('effect-enabled'),
  effectSettings: document.getElementById('effect-settings'),
  effectDropzone: document.getElementById('effect-dropzone'),
  effectPreview: document.getElementById('effect-preview'),
  effectPlaceholder: document.getElementById('effect-placeholder'),
  effectLivePreview: document.getElementById('effect-live-preview'),
  effectLiveMascot: document.getElementById('effect-live-mascot'),
  effectLiveMascotImage: document.getElementById('effect-live-mascot-image'),
  effectLiveImage: document.getElementById('effect-live-image'),
  effectInterval: document.getElementById('effect-interval'),
  effectSize: document.getElementById('effect-size'),
  effectLifetime: document.getElementById('effect-lifetime'),
  effectOffsetX: document.getElementById('effect-offset-x'),
  effectOffsetY: document.getElementById('effect-offset-y'),
  effectWhileStill: document.getElementById('effect-while-still'),
  prepareReleaseButton: document.getElementById('prepare-release-button'),
  reloadButton: document.getElementById('reload-button'),
  saveButton: document.getElementById('save-button'),
  imageEditorDialog: document.getElementById('image-editor-dialog'),
  imageEditorClose: document.getElementById('image-editor-close'),
  imageEditorFrame: document.getElementById('image-editor-preview-frame'),
  imageEditorPreview: document.getElementById('image-editor-preview'),
  imageEditorClippingStatus: document.getElementById('image-editor-clipping-status'),
  imageScale: document.getElementById('image-scale'),
  imageScaleOutput: document.getElementById('image-scale-output'),
  imageOffsetX: document.getElementById('image-offset-x'),
  imageOffsetXOutput: document.getElementById('image-offset-x-output'),
  imageOffsetY: document.getElementById('image-offset-y'),
  imageOffsetYOutput: document.getElementById('image-offset-y-output'),
  imageEditorFlipX: document.getElementById('image-editor-flip-x'),
  imageEditorCancel: document.getElementById('image-editor-cancel'),
  imageEditorReset: document.getElementById('image-editor-reset'),
  imageEditorApply: document.getElementById('image-editor-apply'),
  sizeManagerDialog: document.getElementById('size-manager-dialog'),
  sizeManagerClose: document.getElementById('size-manager-close'),
  sizeManagerStatus: document.getElementById('size-manager-status'),
  sizeManagerAuto: document.getElementById('size-manager-auto'),
  sizeManagerFitClipped: document.getElementById('size-manager-fit-clipped'),
  sizeManagerGrid: document.getElementById('size-manager-grid'),
  sizeManagerMascotSlider: document.getElementById('size-manager-mascot-slider'),
  sizeManagerMascotOutput: document.getElementById('size-manager-mascot-output'),
  sizeManagerMascotSize: document.getElementById('size-manager-mascot-size'),
  sizeManagerScreenPercent: document.getElementById('size-manager-screen-percent'),
  sizeManagerScreenDiagram: document.getElementById('size-manager-screen-diagram'),
  sizeManagerScreenDiagramMaximum: document.getElementById('size-manager-screen-diagram-maximum'),
  sizeManagerScreenDiagramMascot: document.getElementById('size-manager-screen-diagram-mascot'),
  sizeManagerScreenDiagramCaption: document.getElementById('size-manager-screen-diagram-caption'),
  sizeManagerMaxMarker: document.getElementById('size-manager-max-marker'),
  sizeManagerMaxInfo: document.getElementById('size-manager-max-info'),
  sizeManagerSizeWarning: document.getElementById('size-manager-size-warning'),
  sizeManagerScaleEffects: document.getElementById('size-manager-scale-effects'),
  sizeManagerRangeStatus: document.getElementById('size-manager-range-status'),
  sizeManagerTargetSlider: document.getElementById('size-manager-target-slider'),
  sizeManagerTargetPercent: document.getElementById('size-manager-target-percent'),
  sizeManagerTargetOutput: document.getElementById('size-manager-target-output'),
  sizeManagerCancel: document.getElementById('size-manager-cancel'),
  sizeManagerSave: document.getElementById('size-manager-save'),
  durationBulkDialog: document.getElementById('duration-bulk-dialog'),
  durationBulkMin: document.getElementById('duration-bulk-min'),
  durationBulkMax: document.getElementById('duration-bulk-max'),
  durationBulkCount: document.getElementById('duration-bulk-count'),
  durationBulkError: document.getElementById('duration-bulk-error'),
  durationBulkCancel: document.getElementById('duration-bulk-cancel'),
  durationBulkSave: document.getElementById('duration-bulk-save'),
  jpegDialog: document.getElementById('jpeg-dialog'),
  jpegDialogClose: document.getElementById('jpeg-dialog-close'),
  jpegCanvas: document.getElementById('jpeg-canvas'),
  jpegBackgroundColor: document.getElementById('jpeg-background-color'),
  jpegDetectColor: document.getElementById('jpeg-detect-color'),
  jpegTolerance: document.getElementById('jpeg-tolerance'),
  jpegToleranceOutput: document.getElementById('jpeg-tolerance-output'),
  jpegFeather: document.getElementById('jpeg-feather'),
  jpegFeatherOutput: document.getElementById('jpeg-feather-output'),
  jpegCancel: document.getElementById('jpeg-cancel'),
  jpegUseOriginal: document.getElementById('jpeg-use-original'),
  jpegConvert: document.getElementById('jpeg-convert'),
};

const state = {
  apiAvailable: desktopApiAvailable,
  config: null,
  actions: [],
  selectedId: null,
  dirty: false,
  busy: false,
  isPackaged: true,
  revision: 0,
  operationCounter: 0,
  activeOperation: null,
  sizeManagerGeneration: 0,
  jpegGeneration: 0,
  activeJpegCancel: null,
};
const actionCardViews = new Map();
const imagePanBindings = new WeakMap();
const actionMeasurements = new Map();
let measurementQueueRunning = false;
let measurementQueueRequested = false;
let activeImageEditor = null;

function beginSizeManagerGeneration() {
  state.sizeManagerGeneration += 1;
  return state.sizeManagerGeneration;
}

function isSizeManagerGenerationCurrent(generation) {
  return generation === state.sizeManagerGeneration;
}

function invalidateSizeManagerGeneration(generation) {
  if (isSizeManagerGenerationCurrent(generation)) state.sizeManagerGeneration += 1;
}

function beginJpegGeneration() {
  const cancelPrevious = state.activeJpegCancel;
  state.activeJpegCancel = null;
  if (typeof cancelPrevious === 'function') cancelPrevious();
  state.jpegGeneration += 1;
  return state.jpegGeneration;
}

function isJpegGenerationCurrent(generation) {
  return generation === state.jpegGeneration;
}

function invalidateJpegGeneration(generation) {
  if (isJpegGenerationCurrent(generation)) state.jpegGeneration += 1;
}

const movementLabels = {
  still: 'その場に留まる',
  horizontal: '左右に歩く',
  wander: '自由に動く',
  fall: '上から降ってくる',
  launch: '下から発射される',
  orthogonal: '縦横に動く',
};

// Keep in sync with renderer.js SAFE_EDGE_INSET and maximumMascotSize().
const SAFE_EDGE_INSET = 12;

let toastTimer = null;

function newId() {
  return globalThis.crypto?.randomUUID?.() || `action-${Date.now()}-${Math.random()}`;
}

function selectedAction() {
  return state.actions.find((action) => action._uiId === state.selectedId) || null;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readNumberInput(value, fallback = Number.NaN) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string' && value.trim() === '') return Number.NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function numberInputValue(value, fallback, divisor = 1) {
  const number = value === undefined || value === null
    ? fallback
    : readNumberInput(value);
  return Number.isFinite(number) ? number / divisor : '';
}

function secondsToMs(value, fallbackSeconds) {
  return Math.round(readNumberInput(value, fallbackSeconds) * 1000);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function positiveWeight(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return clamp(Math.round(number), 1, 10);
}

function normalizeImageTransform(value) {
  const transform = value && typeof value === 'object' ? value : {};
  return {
    flipX: transform.flipX === true,
    scale: clamp(numberOr(transform.scale, 1), 0.3, 3),
    offsetX: clamp(numberOr(transform.offsetX, 0), -100, 100),
    offsetY: clamp(numberOr(transform.offsetY, 0), -100, 100),
  };
}

const CLIPPING_TOLERANCE = 0.005;
const TIGHT_EDGE_LIMIT = 0.02;
const FRAME_FIT_LIMIT = 0.92;
const SAFE_FRAME_MARGIN = TIGHT_EDGE_LIMIT + CLIPPING_TOLERANCE;
const CLIPPING_EDGE_LABELS = Object.freeze({
  top: '上',
  bottom: '下',
  left: '左',
  right: '右',
});

function measurementForTransform(measurement, transformValue) {
  const transform = normalizeImageTransform(transformValue);
  return transform.flipX
    ? { ...measurement, centerX: 1 - measurement.centerX }
    : measurement;
}

function visibleContentBounds(measurement, transformValue) {
  const transform = normalizeImageTransform(transformValue);
  const adjustedMeasurement = measurementForTransform(measurement, transform);
  const centerX = 0.5 + transform.offsetX / 100
    + transform.scale * (adjustedMeasurement.centerX - 0.5);
  const centerY = 0.5 + transform.offsetY / 100
    + transform.scale * (adjustedMeasurement.centerY - 0.5);
  const halfWidth = transform.scale * adjustedMeasurement.baseWidth / 2;
  const halfHeight = transform.scale * adjustedMeasurement.baseHeight / 2;
  return {
    left: centerX - halfWidth,
    right: centerX + halfWidth,
    top: centerY - halfHeight,
    bottom: centerY + halfHeight,
  };
}

function computeClipping(measurement, transformValue) {
  const bounds = visibleContentBounds(measurement, transformValue);
  const overflow = {
    top: Math.max(0, -bounds.top),
    bottom: Math.max(0, bounds.bottom - 1),
    left: Math.max(0, -bounds.left),
    right: Math.max(0, bounds.right - 1),
  };
  const edges = Object.entries(overflow)
    .filter(([, amount]) => amount > CLIPPING_TOLERANCE)
    .map(([edge, amount]) => ({ edge, amount, percent: amount * 100 }));
  const tight = Object.entries({
    top: bounds.top >= -CLIPPING_TOLERANCE && bounds.top <= TIGHT_EDGE_LIMIT,
    bottom: bounds.bottom <= 1 + CLIPPING_TOLERANCE && bounds.bottom >= 1 - TIGHT_EDGE_LIMIT,
    left: bounds.left >= -CLIPPING_TOLERANCE && bounds.left <= TIGHT_EDGE_LIMIT,
    right: bounds.right <= 1 + CLIPPING_TOLERANCE && bounds.right >= 1 - TIGHT_EDGE_LIMIT,
  })
    .filter(([, isTight]) => isTight)
    .map(([edge]) => edge);
  return { clipped: edges.length > 0, edges, tight, overflow, bounds };
}

function formatClippingStatus(clipping) {
  const details = clipping.edges.map(({ edge, percent }) => (
    `${CLIPPING_EDGE_LABELS[edge]}（約 ${Math.max(1, Math.round(percent))}%）`
  ));
  if (details.length === 1) {
    const [detail] = details;
    return `⚠ ${detail.replace('（', 'が切れています（')}`;
  }
  return `⚠ ${details.join('・')}が切れています`;
}

function formatTightStatus(clipping) {
  const edges = clipping.tight.map((edge) => CLIPPING_EDGE_LABELS[edge]);
  return `⚠ ${edges.join('・')}が枠にぎりぎりです`;
}

function hasFrameIssue(clipping) {
  return Boolean(clipping && (clipping.clipped || clipping.tight.length > 0));
}

function fitTransformToFrame(measurement, transformValue) {
  const transform = normalizeImageTransform(transformValue);
  const baseSize = Math.max(measurement.baseWidth, measurement.baseHeight);
  if (baseSize > 0) {
    transform.scale = clamp(
      Math.min(transform.scale, FRAME_FIT_LIMIT / baseSize),
      SETTINGS_RULES.imageScale.minimum,
      SETTINGS_RULES.imageScale.maximum,
    );
  }

  const correctOffset = (offset, start, end) => {
    let corrected = offset;
    if (start < SAFE_FRAME_MARGIN) corrected += (SAFE_FRAME_MARGIN - start) * 100;
    else if (end > 1 - SAFE_FRAME_MARGIN) corrected -= (end - (1 - SAFE_FRAME_MARGIN)) * 100;
    return clamp(Math.round(corrected * 100) / 100, -100, 100);
  };
  let bounds = visibleContentBounds(measurement, transform);
  transform.offsetX = correctOffset(transform.offsetX, bounds.left, bounds.right);
  bounds = visibleContentBounds(measurement, transform);
  transform.offsetY = correctOffset(transform.offsetY, bounds.top, bounds.bottom);
  return normalizeImageTransform(transform);
}

function applyImageTransform(imageElement, transformValue) {
  const transform = normalizeImageTransform(transformValue);
  const flipX = transform.flipX ? 'scaleX(-1) ' : '';
  imageElement.style.transform = `translate(${transform.offsetX}%, ${transform.offsetY}%) ${flipX}scale(${transform.scale})`;
}

function formatImageOffset(value) {
  const formatted = String(Number(value.toFixed(2)));
  return value > 0 ? `+${formatted}` : formatted;
}

function attachImagePan(frame, transform, onChange) {
  const existingBinding = imagePanBindings.get(frame);
  if (existingBinding) {
    existingBinding.update(transform, onChange);
    return;
  }

  let currentTransform = transform;
  let currentOnChange = onChange;
  let activeDrag = null;
  frame.addEventListener('pointerdown', (event) => {
    if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    const bounds = frame.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    activeDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: currentTransform.offsetX,
      offsetY: currentTransform.offsetY,
      width: bounds.width,
      height: bounds.height,
    };
    frame.setPointerCapture(event.pointerId);
    frame.classList.add('is-dragging');
    event.preventDefault();
  });
  frame.addEventListener('pointermove', (event) => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    currentTransform.offsetX = clamp(
      Math.round((activeDrag.offsetX + (event.clientX - activeDrag.startX) / activeDrag.width * 100) * 100) / 100,
      -100,
      100,
    );
    currentTransform.offsetY = clamp(
      Math.round((activeDrag.offsetY + (event.clientY - activeDrag.startY) / activeDrag.height * 100) * 100) / 100,
      -100,
      100,
    );
    currentOnChange(currentTransform);
  });
  const finishDrag = (event) => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    if (frame.hasPointerCapture?.(event.pointerId)) frame.releasePointerCapture(event.pointerId);
    activeDrag = null;
    frame.classList.remove('is-dragging');
  };
  frame.addEventListener('pointerup', finishDrag);
  frame.addEventListener('pointercancel', finishDrag);
  imagePanBindings.set(frame, {
    update(nextTransform, nextOnChange) {
      currentTransform = nextTransform;
      currentOnChange = nextOnChange;
    },
  });
}

function disableUnavailableEditor() {
  state.apiAvailable = false;
  state.busy = false;
  state.dirty = false;
  state.activeOperation = null;
  for (const element of Object.values(elements)) {
    if (element && 'disabled' in element) element.disabled = true;
  }
  elements.prepareReleaseButton.hidden = true;
  elements.actionEditor.hidden = true;
  elements.emptyState.hidden = false;
  elements.saveState.textContent = 'デスクトップアプリが必要';
  elements.saveState.classList.remove('is-dirty', 'is-saved');
  elements.feedback.textContent = '設定機能を利用できません。デスクトップアプリを再起動してください。';
  elements.feedback.classList.add('is-error');
}

function setBusy(busy) {
  if (!state.apiAvailable) {
    disableUnavailableEditor();
    return;
  }
  state.busy = busy;
  elements.saveButton.disabled = busy || !state.dirty;
  elements.reloadButton.disabled = busy;
  elements.prepareReleaseButton.disabled = busy;
  elements.addAction.disabled = busy || state.actions.length >= MAX_ACTIONS;
  elements.actionFitInFrame.disabled = busy;
  elements.openSizeManager.disabled = busy;
  elements.openDurationBulk.disabled = busy || state.actions.length === 0;
  elements.recoveryBackup.disabled = busy || Boolean(elements.recoveryBackup.dataset.unavailable);
  elements.recoveryDefaults.disabled = busy;
}

function beginOperation(label = 'operation') {
  if (!state.apiAvailable || state.activeOperation) return null;
  const token = Object.freeze({ id: ++state.operationCounter, label });
  state.activeOperation = token;
  setBusy(true);
  return token;
}

function endOperation(token) {
  if (!token || state.activeOperation !== token) return false;
  state.activeOperation = null;
  setBusy(false);
  return true;
}

function markDirty() {
  if (!state.apiAvailable) return;
  state.revision += 1;
  state.dirty = true;
  window.mascotAPI.reportDirtyState(true);
  elements.saveState.textContent = '未保存の変更';
  elements.saveState.classList.add('is-dirty');
  elements.saveState.classList.remove('is-saved');
  elements.feedback.textContent = '変更はまだ保存されていません。';
  elements.feedback.classList.remove('is-error');
  elements.saveButton.disabled = state.busy;
}

function markSaved() {
  state.dirty = false;
  window.mascotAPI.reportDirtyState(false);
  elements.saveState.textContent = '保存済み';
  elements.saveState.classList.remove('is-dirty');
  elements.saveState.classList.add('is-saved');
  elements.feedback.textContent = '設定はマスコットへ反映されています。';
  elements.feedback.classList.remove('is-error');
  elements.saveButton.disabled = true;
}

function markLoaded() {
  state.dirty = false;
  window.mascotAPI.reportDirtyState(false);
  elements.saveState.textContent = '読み込み済み';
  elements.saveState.classList.remove('is-dirty', 'is-saved');
  elements.feedback.textContent = '設定ファイルを読み込みました。マスコットへの反映状態は未確認です。';
  elements.feedback.classList.remove('is-error');
  elements.saveButton.disabled = true;
}

function showError(message) {
  elements.feedback.textContent = message;
  elements.feedback.classList.add('is-error');
  showToast(message, true);
}

function readableError(error) {
  return String(error?.message || error || '')
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
}

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('is-error', isError);
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

function setImagePreview(imageElement, placeholderElement, url) {
  const hasImage = Boolean(url);
  imageElement.hidden = !hasImage;
  placeholderElement.hidden = hasImage;
  if (hasImage) imageElement.src = url;
  else imageElement.removeAttribute('src');
}

async function resolveAction(action) {
  const assetUrl = action.file ? await window.mascotAPI.resolveAsset(action.file) : null;
  let effect = undefined;

  if (action.effect) {
    const effectAssetUrl = action.effect.file
      ? await window.mascotAPI.resolveAsset(action.effect.file)
      : null;
    effect = { ...action.effect, _assetUrl: effectAssetUrl };
  }

  const flipMode = ['direction', 'none', 'random'].includes(action.flipMode)
    ? action.flipMode
    : 'direction';

  return {
    ...action,
    _uiId: newId(),
    _assetUrl: assetUrl,
    weight: positiveWeight(action.weight, 1),
    flipMode,
    imageTransform: normalizeImageTransform(action.imageTransform),
    movement: { type: 'still', speed: 0, ...(action.movement || {}) },
    durationMs: Array.isArray(action.durationMs) ? action.durationMs : [...DEFAULT_DURATION_MS],
    ...(effect ? { effect } : {}),
  };
}

async function loadConfiguration({ askBeforeDiscard = false } = {}) {
  if (!state.apiAvailable) {
    disableUnavailableEditor();
    return;
  }
  if (askBeforeDiscard && state.dirty) {
    const confirmed = window.confirm('保存していない変更を破棄しますか？');
    if (!confirmed) return;
  }

  const operation = beginOperation('load-configuration');
  if (!operation) return;
  try {
    elements.saveState.textContent = '読み込み中';
    elements.saveState.classList.remove('is-dirty', 'is-saved');

    const [editable, appInfo] = await Promise.all([
      window.mascotAPI.loadConfig(),
      window.mascotAPI.getAppInfo(),
    ]);
    const { config } = editable || {};
    state.isPackaged = Boolean(appInfo?.isPackaged);
    elements.prepareReleaseButton.hidden = state.isPackaged;
    const warnings = Array.isArray(editable?.warnings) ? editable.warnings : [];
    const recovery = editable?.recovery || { kind: 'none' };
    const needsRecovery = !config || warnings.length > 0;
    elements.recoveryPanel.hidden = !needsRecovery;
    elements.recoveryMessage.textContent = !config
      ? (recovery.message || '設定ファイルを読み込めません。下のボタンから安全に復旧できます。')
      : warnings.join('／');
    elements.recoveryBackup.dataset.unavailable = recovery.canRestoreBackup ? '' : 'true';
    elements.recoveryBackup.disabled = !recovery.canRestoreBackup;
    if (!config) {
      state.config = null;
      state.actions = [];
      state.selectedId = null;
      state.revision = 0;
      renderAll();
      state.dirty = false;
      window.mascotAPI.reportDirtyState(false);
      elements.saveState.textContent = '復旧が必要';
      elements.saveState.classList.remove('is-dirty', 'is-saved');
      elements.feedback.textContent = '元のファイルは上書きしていません。復旧方法を選んでください。';
      elements.feedback.classList.add('is-error');
      return;
    }
    const actions = await mapWithConcurrency(config.actions || [], 4, resolveAction);
    state.config = {
      ...config,
      mascot: {
        size: 180,
        startPosition: 'bottom-right',
        margin: 40,
        rememberPosition: true,
        ...(config.mascot || {}),
      },
    };
    state.actions = actions;
    state.selectedId = actions[0]?._uiId || null;
    state.revision = 0;
    renderAll();
    markLoaded();
    if (warnings.length > 0) {
      elements.feedback.textContent = '見つからない画像を新しい画像へ差し替えて保存してください。';
      elements.feedback.classList.add('is-error');
    }
  } catch (error) {
    console.error(error);
    showError(`設定を読み込めませんでした：${readableError(error)}`);
  } finally {
    endOperation(operation);
  }
}

async function recoverConfiguration(strategy) {
  if (state.busy) return false;
  if (strategy === 'defaults') {
    const confirmed = window.confirm('同梱の初期設定へ戻します。追加した画像は削除しません。続けますか？');
    if (!confirmed) return false;
  }
  const operation = beginOperation(`recover-${strategy}`);
  if (!operation) return false;
  let recovered = false;
  try {
    const result = await window.mascotAPI.recoverConfig(strategy);
    if (!result?.ok) throw new Error(result?.error || '設定を復旧できませんでした。');
    recovered = true;
    showToast(strategy === 'backup' ? '直前の正常な設定へ戻しました。' : '初期設定へ戻しました。');
  } catch (error) {
    console.error(error);
    showError(readableError(error));
  } finally {
    endOperation(operation);
  }
  if (recovered) await loadConfiguration();
  return recovered;
}

function renderGlobalSettings() {
  const mascot = state.config?.mascot;
  if (!mascot) return;
  elements.mascotName.value = state.config.name || '';
  elements.mascotSize.value = mascot.size;
  elements.mascotSizeOutput.textContent = `${mascot.size} px`;
  elements.startPosition.value = mascot.startPosition;
  elements.rememberPosition.checked = mascot.rememberPosition !== false;
}

function renderActionList() {
  elements.addAction.disabled = state.busy || state.actions.length >= MAX_ACTIONS;
  elements.openDurationBulk.disabled = state.busy || state.actions.length === 0;
  elements.actionList.replaceChildren();
  actionCardViews.clear();

  for (const action of state.actions) {
    const item = document.createElement('li');
    const card = document.createElement('div');
    const button = document.createElement('button');
    const thumbnail = document.createElement('span');
    const copy = document.createElement('span');
    const name = document.createElement('span');
    const meta = document.createElement('span');
    const weightLabel = document.createElement('label');
    const weightText = document.createElement('span');
    const weightInput = document.createElement('input');
    const selected = action._uiId === state.selectedId;
    const clipping = getActionClipping(action, action.imageTransform);
    const frameIssue = hasFrameIssue(clipping);
    const warningLabel = clipping?.clipped
      ? '画像が枠から見切れています'
      : '画像が枠にぎりぎりです';
    let warning = null;

    card.className = 'action-item-card';
    card.classList.toggle('is-selected', selected);

    button.type = 'button';
    button.className = 'action-item-select';
    button.title = frameIssue
      ? warningLabel
      : action.name || '名前のない動作';
    button.setAttribute('aria-current', selected ? 'true' : 'false');

    thumbnail.className = 'action-thumb';
    if (action._assetUrl) {
      const image = document.createElement('img');
      image.src = action._assetUrl;
      image.alt = '';
      applyImageTransform(image, action.imageTransform);
      thumbnail.appendChild(image);
    } else {
      thumbnail.textContent = '＋';
    }

    copy.className = 'action-copy';
    name.className = 'action-name';
    name.textContent = action.name || '名前のない動作';
    if (frameIssue) {
      warning = document.createElement('span');
      warning.className = 'action-clipping-warning';
      warning.textContent = ' ⚠';
      warning.title = warningLabel;
      warning.setAttribute('aria-label', warningLabel);
      name.appendChild(warning);
    }
    meta.className = 'action-meta';
    meta.textContent = movementLabels[action.movement?.type] || '動き未設定';
    copy.append(name, meta);

    button.append(thumbnail, copy);
    button.addEventListener('click', () => {
      state.selectedId = action._uiId;
      renderActionList();
      renderEditor();
    });

    weightLabel.className = 'action-list-weight';
    weightLabel.title = '選ばれやすさ（1〜10）';
    weightText.textContent = '頻度';
    weightInput.type = 'number';
    weightInput.min = '1';
    weightInput.max = '10';
    weightInput.step = '1';
    weightInput.inputMode = 'numeric';
    weightInput.value = numberInputValue(action.weight, 1);
    weightInput.setAttribute('aria-label', `${action.name || 'この動作'}の選ばれやすさ`);
    weightInput.addEventListener('click', (event) => event.stopPropagation());
    weightInput.addEventListener('change', () => {
      action.weight = positiveWeight(weightInput.value, 1);
      weightInput.value = String(action.weight);
      if (selectedAction()?._uiId === action._uiId) elements.actionWeight.value = String(action.weight);
      markDirty();
    });
    weightLabel.append(weightText, weightInput);

    card.append(button, weightLabel);
    item.appendChild(card);
    elements.actionList.appendChild(item);
    actionCardViews.set(action._uiId, { button, name, weightInput, warning });
  }
}

function renderEffectLivePreview() {
  const action = selectedAction();
  const effect = action?.effect;
  if (!action || !effect || elements.effectSettings.hidden) {
    elements.effectLiveImage.hidden = true;
    return;
  }

  const stageWidth = elements.effectLivePreview.clientWidth || 360;
  const stageHeight = elements.effectLivePreview.clientHeight || 300;
  const actualMascotSize = Math.max(48, numberOr(state.config?.mascot?.size, 180));
  const previewMascotSize = Math.min(180, stageWidth * 0.5, stageHeight * 0.62);
  const previewRatio = previewMascotSize / actualMascotSize;
  const mascotLeft = (stageWidth - previewMascotSize) / 2;
  const mascotTop = Math.max(42, (stageHeight - previewMascotSize) / 2 + 8);

  elements.effectLiveMascot.style.width = `${previewMascotSize}px`;
  elements.effectLiveMascot.style.height = `${previewMascotSize}px`;
  elements.effectLiveMascot.style.left = `${mascotLeft}px`;
  elements.effectLiveMascot.style.top = `${mascotTop}px`;
  if (action._assetUrl) {
    elements.effectLiveMascotImage.src = action._assetUrl;
    applyImageTransform(elements.effectLiveMascotImage, action.imageTransform);
  } else {
    elements.effectLiveMascotImage.removeAttribute('src');
  }

  if (!effect._assetUrl) {
    elements.effectLiveImage.hidden = true;
    return;
  }

  const effectSize = Math.max(4, numberOr(effect.size, 32)) * previewRatio;
  const effectLeft = mascotLeft
    + previewMascotSize / 2
    + numberOr(effect.offsetX, 0) * previewRatio;
  const effectTop = mascotTop
    + previewMascotSize
    - numberOr(effect.offsetY, 12) * previewRatio;

  elements.effectLiveImage.src = effect._assetUrl;
  elements.effectLiveImage.hidden = false;
  elements.effectLiveImage.style.width = `${effectSize}px`;
  elements.effectLiveImage.style.left = `${effectLeft}px`;
  elements.effectLiveImage.style.top = `${effectTop}px`;
  elements.effectLiveImage.title = `横 ${numberOr(effect.offsetX, 0)} px・縦 ${numberOr(effect.offsetY, 12)} px`;
}

function currentActionMeasurement(action) {
  const entry = action && actionMeasurements.get(action._uiId);
  return entry?.key === actionMeasurementKey(action) && entry.status === 'ready'
    ? entry.measurement
    : null;
}

function getActionClipping(action, transform) {
  const measurement = currentActionMeasurement(action);
  return measurement ? computeClipping(measurement, transform) : null;
}

function updateClippingStatus(element, action, transform, { explainClipping = false } = {}) {
  const entry = action && actionMeasurements.get(action._uiId);
  if (!action?._assetUrl) {
    element.textContent = '';
    element.classList.remove('is-warning');
    return null;
  }
  if (!entry || entry.key !== actionMeasurementKey(action) || entry.status === 'pending') {
    element.textContent = '測定中…';
    element.classList.remove('is-warning');
    return null;
  }
  if (entry.status === 'error') {
    element.textContent = '画像を測定できませんでした。';
    element.classList.remove('is-warning');
    return null;
  }
  const clipping = computeClipping(entry.measurement, transform);
  const status = clipping.clipped
    ? formatClippingStatus(clipping)
    : clipping.tight.length > 0
      ? formatTightStatus(clipping)
      : '見切れなし';
  element.textContent = `${status}${clipping.clipped && explainClipping ? '。枠からはみ出した部分は、表示されません。' : ''}`;
  element.classList.toggle('is-warning', hasFrameIssue(clipping));
  return clipping;
}

function fitActionIntoFrame(action) {
  const measurement = currentActionMeasurement(action);
  if (!measurement) {
    showError('画像の測定が終わってから、もう一度押してください。');
    return false;
  }
  action.imageTransform = fitTransformToFrame(measurement, action.imageTransform);
  const clipping = computeClipping(measurement, action.imageTransform);
  if (hasFrameIssue(clipping)) {
    showError('画像に十分な余白を作れませんでした。');
    renderActionList();
    renderEditor();
    return false;
  }
  markDirty();
  renderActionList();
  renderEditor();
  showToast('枠に収めました。');
  return true;
}

function renderEditor() {
  const action = selectedAction();
  const hasAction = Boolean(action);
  elements.emptyState.hidden = hasAction;
  elements.actionEditor.hidden = !hasAction;
  if (!action) {
    elements.actionClippingStatus.textContent = '';
    elements.actionFitInFrame.hidden = true;
    return;
  }

  const index = state.actions.findIndex((candidate) => candidate._uiId === action._uiId);
  elements.moveUp.disabled = index <= 0;
  elements.moveDown.disabled = index < 0 || index >= state.actions.length - 1;
  elements.deleteAction.disabled = state.actions.length <= 1;

  setImagePreview(elements.actionPreview, elements.actionPlaceholder, action._assetUrl);
  elements.actionPreviewFrame.hidden = !action._assetUrl;
  applyImageTransform(elements.actionPreview, action.imageTransform);
  elements.imageEditButton.disabled = !action._assetUrl;
  const clipping = updateClippingStatus(elements.actionClippingStatus, action, action.imageTransform);
  elements.actionFitInFrame.hidden = !hasFrameIssue(clipping);
  elements.actionFitInFrame.disabled = state.busy;
  elements.actionFitInFrame.onclick = () => fitActionIntoFrame(action);
  elements.actionName.value = action.name || '';
  elements.actionWeight.value = numberInputValue(action.weight, 1);
  elements.flipDirection.value = action.flipMode || 'direction';
  elements.imageFlipX.checked = action.imageTransform?.flipX === true;
  elements.durationMin.value = numberInputValue(action.durationMs?.[0], DEFAULT_DURATION_MS[0], 1000);
  elements.durationMax.value = numberInputValue(action.durationMs?.[1], DEFAULT_DURATION_MS[1], 1000);
  elements.movementType.value = action.movement?.type || 'still';
  elements.movementSpeed.value = numberInputValue(action.movement?.speed, 0);
  elements.speedOutput.textContent = elements.movementSpeed.value;
  elements.movementSpeed.disabled = elements.movementType.value === 'still';

  const effectEnabled = Boolean(action.effect);
  elements.effectEnabled.checked = effectEnabled;
  elements.effectSettings.hidden = !effectEnabled;

  if (effectEnabled) {
    setImagePreview(elements.effectPreview, elements.effectPlaceholder, action.effect._assetUrl);
    elements.effectInterval.value = numberInputValue(action.effect.intervalMs, 450, 1000);
    elements.effectSize.value = numberInputValue(action.effect.size, 32);
    elements.effectLifetime.value = numberInputValue(action.effect.lifetimeMs, 1800, 1000);
    elements.effectOffsetX.value = numberInputValue(action.effect.offsetX, 0);
    elements.effectOffsetY.value = numberInputValue(action.effect.offsetY, 12);
    elements.effectWhileStill.checked = Boolean(action.effect.emitWhileStill);
    renderEffectLivePreview();
    requestAnimationFrame(renderEffectLivePreview);
  } else {
    elements.effectLiveImage.hidden = true;
  }
}

function renderAll() {
  renderGlobalSettings();
  renderActionList();
  renderEditor();
  requestVisibleContentMeasurements();
}

function editSelectedAction(update) {
  const action = selectedAction();
  if (!action) return;
  update(action);
  markDirty();
}

function updateActionName() {
  const action = selectedAction();
  if (!action) return;
  editSelectedAction((action) => {
    action.name = elements.actionName.value;
  });
  const view = actionCardViews.get(action._uiId);
  if (!view) {
    renderActionList();
    return;
  }
  const displayName = action.name || '名前のない動作';
  const clipping = getActionClipping(action, action.imageTransform);
  const frameIssue = hasFrameIssue(clipping);
  const warningLabel = clipping?.clipped
    ? '画像が枠から見切れています'
    : '画像が枠にぎりぎりです';
  view.button.title = frameIssue ? warningLabel : displayName;
  view.name.textContent = displayName;
  if (view.warning && frameIssue) view.name.appendChild(view.warning);
  view.weightInput.setAttribute('aria-label', `${displayName}の選ばれやすさ`);
}

function addAction() {
  if (state.actions.length >= MAX_ACTIONS) {
    showError(`動作は${MAX_ACTIONS}件まで追加できます。`);
    elements.addAction.disabled = true;
    return;
  }
  const action = {
    _uiId: newId(),
    _assetUrl: null,
    name: `新しい動作 ${state.actions.length + 1}`,
    file: '',
    weight: 1,
    durationMs: [...DEFAULT_DURATION_MS],
    flipMode: 'direction',
    imageTransform: normalizeImageTransform(),
    movement: { type: 'still', speed: 0 },
  };
  state.actions.push(action);
  state.selectedId = action._uiId;
  markDirty();
  renderActionList();
  renderEditor();
  elements.actionName.focus();
  elements.actionName.select();
}

function openDurationBulkDialog() {
  if (state.busy) return;
  if (state.actions.length === 0) {
    showError('一括設定する動作がありません。');
    return;
  }

  const duration = selectedAction()?.durationMs;
  elements.durationBulkMin.value = numberOr(duration?.[0], DEFAULT_DURATION_MS[0]) / 1000;
  elements.durationBulkMax.value = numberOr(duration?.[1], DEFAULT_DURATION_MS[1]) / 1000;
  elements.durationBulkCount.textContent = `全${state.actions.length}件の動作の時間が、上書きされます。`;
  elements.durationBulkError.textContent = '';
  elements.durationBulkError.hidden = true;
  elements.durationBulkDialog.showModal();
}

function readBulkDuration() {
  elements.durationBulkError.textContent = '';
  elements.durationBulkError.hidden = true;
  const minimumSeconds = readNumberInput(elements.durationBulkMin.value);
  const maximumSeconds = readNumberInput(elements.durationBulkMax.value);
  if (!Number.isFinite(minimumSeconds)) {
    elements.durationBulkError.textContent = '最短時間を入力してください。';
    elements.durationBulkError.hidden = false;
    return null;
  }
  if (!Number.isFinite(maximumSeconds)) {
    elements.durationBulkError.textContent = '最長時間を入力してください。';
    elements.durationBulkError.hidden = false;
    return null;
  }
  if (
    minimumSeconds < SETTINGS_RULES.durationMs.minimum / 1000
    || minimumSeconds > SETTINGS_RULES.durationMs.maximum / 1000
    || maximumSeconds < SETTINGS_RULES.durationMs.minimum / 1000
    || maximumSeconds > SETTINGS_RULES.durationMs.maximum / 1000
  ) {
    elements.durationBulkError.textContent = '最短時間と最長時間は0.5〜600秒にしてください。';
    elements.durationBulkError.hidden = false;
    return null;
  }

  const duration = [
    secondsToMs(minimumSeconds, DEFAULT_DURATION_MS[0] / 1000),
    secondsToMs(maximumSeconds, DEFAULT_DURATION_MS[1] / 1000),
  ];
  if (duration[0] > duration[1]) {
    elements.durationBulkError.textContent = '最短時間は最長時間以下にしてください。';
    elements.durationBulkError.hidden = false;
    return null;
  }
  return duration;
}

async function applyDurationBulk() {
  const duration = readBulkDuration();
  if (!duration) return false;

  for (const action of state.actions) action.durationMs = [...duration];
  markDirty();
  elements.durationBulkDialog.close();
  renderActionList();
  renderEditor();

  return saveConfiguration();
}

function deleteSelectedAction() {
  const action = selectedAction();
  if (!action || state.actions.length <= 1) return;
  if (!window.confirm(`「${action.name || 'この動作'}」を設定から削除しますか？\n画像ファイル自体は削除されません。`)) return;

  const index = state.actions.findIndex((candidate) => candidate._uiId === action._uiId);
  state.actions.splice(index, 1);
  state.selectedId = state.actions[Math.max(0, index - 1)]?._uiId || null;
  markDirty();
  renderActionList();
  renderEditor();
}

function moveSelectedAction(direction) {
  const index = state.actions.findIndex((action) => action._uiId === state.selectedId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= state.actions.length) return;
  const [action] = state.actions.splice(index, 1);
  state.actions.splice(nextIndex, 0, action);
  markDirty();
  renderActionList();
  renderEditor();
}

async function importImage(category, sourcePath = '', operationToken = null) {
  if (!state.apiAvailable) {
    disableUnavailableEditor();
    return null;
  }
  const ownsOperation = !operationToken;
  const operation = operationToken || beginOperation('import-image');
  if (!operation) return null;
  try {
    const result = sourcePath
      ? await window.mascotAPI.importImage(sourcePath, category)
      : await window.mascotAPI.chooseImage(category);
    if (!result) return null;
    return result;
  } catch (error) {
    console.error(error);
    showError(`画像を追加できませんでした：${readableError(error)}`);
    return null;
  } finally {
    if (ownsOperation) endOperation(operation);
  }
}

function isJpegImport(result) {
  return Boolean(result?.isJpeg || /\.jpe?g$/i.test(result?.relativePath || ''));
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(hex) {
  const normalized = String(hex || '#ffffff').replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16) || 0,
    g: Number.parseInt(normalized.slice(2, 4), 16) || 0,
    b: Number.parseInt(normalized.slice(4, 6), 16) || 0,
  };
}

function loadConverterImage(source, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve(image);
    };
    const timer = window.setTimeout(
      () => finish(new Error('JPG画像の読み込みが時間切れになりました。')),
      timeoutMs,
    );
    image.onload = () => finish();
    image.onerror = () => finish(new Error('JPG画像をプレビューできませんでした。'));
    image.src = source;
  });
}

function detectCornerColor(imageData) {
  const { width, height, data } = imageData;
  const sampleSize = Math.max(1, Math.min(18, Math.floor(Math.min(width, height) * 0.04)));
  const corners = [
    [0, 0],
    [width - sampleSize, 0],
    [0, height - sampleSize],
    [width - sampleSize, height - sampleSize],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (const [startX, startY] of corners) {
    for (let y = startY; y < startY + sampleSize; y += 1) {
      for (let x = startX; x < startX + sampleSize; x += 1) {
        const index = (y * width + x) * 4;
        r += data[index];
        g += data[index + 1];
        b += data[index + 2];
        count += 1;
      }
    }
  }

  return { r: r / count, g: g / count, b: b / count };
}

function makeTransparentImageData(original, background, tolerance, feather) {
  const output = new ImageData(
    new Uint8ClampedArray(original.data),
    original.width,
    original.height,
  );
  const featherEnd = tolerance + feather;

  for (let index = 0; index < output.data.length; index += 4) {
    const deltaR = output.data[index] - background.r;
    const deltaG = output.data[index + 1] - background.g;
    const deltaB = output.data[index + 2] - background.b;
    const distance = Math.sqrt(deltaR ** 2 + deltaG ** 2 + deltaB ** 2);

    if (distance <= tolerance) {
      output.data[index + 3] = 0;
    } else if (feather > 0 && distance < featherEnd) {
      output.data[index + 3] = Math.round(255 * ((distance - tolerance) / feather));
    } else {
      output.data[index + 3] = 255;
    }
  }

  return output;
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG画像を作成できませんでした。'));
    }, 'image/png');
  });
}

async function openJpegConverter(result, category) {
  const generation = beginJpegGeneration();
  const source = result.assetUrl;
  let image;
  try {
    image = await loadConverterImage(source);
  } catch (error) {
    invalidateJpegGeneration(generation);
    throw error;
  }
  if (!isJpegGenerationCurrent(generation)) return null;
  const maximumDimension = 2048;
  const scale = Math.min(1, maximumDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = elements.jpegCanvas;
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const original = context.getImageData(0, 0, canvas.width, canvas.height);
  const detectedBackground = detectCornerColor(original);

  elements.jpegBackgroundColor.value = rgbToHex(detectedBackground);
  elements.jpegTolerance.value = '45';
  elements.jpegFeather.value = '20';
  elements.jpegToleranceOutput.textContent = '45';
  elements.jpegFeatherOutput.textContent = '20';

  let renderRequest = null;
  const renderPreview = () => {
    if (!isJpegGenerationCurrent(generation)) return;
    if (renderRequest) cancelAnimationFrame(renderRequest);
    renderRequest = requestAnimationFrame(() => {
      if (!isJpegGenerationCurrent(generation)) return;
      const background = hexToRgb(elements.jpegBackgroundColor.value);
      const tolerance = numberOr(elements.jpegTolerance.value, 45);
      const feather = numberOr(elements.jpegFeather.value, 20);
      const converted = makeTransparentImageData(original, background, tolerance, feather);
      context.putImageData(converted, 0, 0);
      elements.jpegToleranceOutput.textContent = String(tolerance);
      elements.jpegFeatherOutput.textContent = String(feather);
    });
  };

  renderPreview();

  return new Promise((resolve) => {
    let settled = false;
    let saving = false;
    let cancelActive = null;

    const setSaving = (value) => {
      saving = value;
      elements.jpegConvert.disabled = value;
      elements.jpegCancel.disabled = value;
      elements.jpegUseOriginal.disabled = value;
      elements.jpegDialogClose.disabled = value;
      elements.jpegDetectColor.disabled = value;
    };

    const cleanup = () => {
      if (renderRequest) cancelAnimationFrame(renderRequest);
      renderRequest = null;
      elements.jpegBackgroundColor.oninput = null;
      elements.jpegTolerance.oninput = null;
      elements.jpegFeather.oninput = null;
      elements.jpegDetectColor.onclick = null;
      elements.jpegCancel.onclick = null;
      elements.jpegDialogClose.onclick = null;
      elements.jpegUseOriginal.onclick = null;
      elements.jpegConvert.onclick = null;
      elements.jpegDialog.oncancel = null;
      if (state.activeJpegCancel === cancelActive) state.activeJpegCancel = null;
      setSaving(false);
      canvas.width = 1;
      canvas.height = 1;
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      invalidateJpegGeneration(generation);
      cleanup();
      if (elements.jpegDialog.open) elements.jpegDialog.close();
      resolve(value);
    };

    cancelActive = () => finish(null);
    state.activeJpegCancel = cancelActive;

    elements.jpegBackgroundColor.oninput = renderPreview;
    elements.jpegTolerance.oninput = renderPreview;
    elements.jpegFeather.oninput = renderPreview;
    elements.jpegDetectColor.onclick = () => {
      elements.jpegBackgroundColor.value = rgbToHex(detectedBackground);
      renderPreview();
    };
    elements.jpegCancel.onclick = () => { if (!saving) finish(null); };
    elements.jpegDialogClose.onclick = () => { if (!saving) finish(null); };
    elements.jpegUseOriginal.onclick = () => { if (!saving) finish(result); };
    elements.jpegDialog.oncancel = (event) => {
      event.preventDefault();
      if (!saving) finish(null);
    };
    elements.jpegConvert.onclick = async () => {
      try {
        setSaving(true);
        renderPreview();
        await new Promise((done) => requestAnimationFrame(done));
        if (!isJpegGenerationCurrent(generation)) return;
        const blob = await canvasToPngBlob(canvas);
        if (!isJpegGenerationCurrent(generation)) return;
        const converted = await window.mascotAPI.saveTransparentPng(
          await blob.arrayBuffer(),
          category,
          result.relativePath,
        );
        if (!isJpegGenerationCurrent(generation)) return;
        showToast('JPGの背景を透明なPNGに変換しました。');
        finish(converted);
      } catch (error) {
        console.error(error);
        if (isJpegGenerationCurrent(generation)) {
          showError(`背景を透明にできませんでした：${readableError(error)}`);
        }
      } finally {
        if (isJpegGenerationCurrent(generation)) setSaving(false);
      }
    };

    setSaving(false);
    elements.jpegDialog.showModal();
  });
}

async function prepareImportedImage(result, category) {
  if (!isJpegImport(result)) return result;
  try {
    return await openJpegConverter(result, category);
  } catch (error) {
    console.error(error);
    showError(`JPGの背景透過を準備できませんでした：${readableError(error)}`);
    return null;
  }
}

async function importAndPrepareImage(category, sourcePath = '') {
  const operation = beginOperation('import-and-prepare-image');
  if (!operation) return null;
  try {
    const result = await importImage(category, sourcePath, operation);
    return result ? await prepareImportedImage(result, category) : null;
  } finally {
    endOperation(operation);
  }
}

function setupDropzone(element, category, onImported) {
  element.addEventListener('click', async () => {
    if (!state.apiAvailable) return;
    const targetId = state.selectedId;
    const prepared = await importAndPrepareImage(category);
    if (prepared) onImported(prepared, targetId);
  });

  element.addEventListener('dragenter', (event) => {
    event.preventDefault();
    element.classList.add('is-dragover');
  });
  element.addEventListener('dragover', (event) => {
    event.preventDefault();
    element.classList.add('is-dragover');
  });
  element.addEventListener('dragleave', () => element.classList.remove('is-dragover'));
  element.addEventListener('drop', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    element.classList.remove('is-dragover');
    if (!state.apiAvailable) return;

    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const sourcePath = window.mascotAPI.getPathForFile(file);
    if (!sourcePath) {
      showError('画像の場所を取得できませんでした。クリックして画像を選んでください。');
      return;
    }

    const targetId = state.selectedId;
    const prepared = await importAndPrepareImage(category, sourcePath);
    if (prepared) onImported(prepared, targetId);
  });
}

function applyImportedActionImage(result, targetId) {
  const action = state.actions.find((candidate) => candidate._uiId === targetId);
  if (!action) return;
  actionMeasurements.delete(action._uiId);
  action.file = result.relativePath;
  action._assetUrl = result.assetUrl;
  action.imageTransform = normalizeImageTransform();
  state.selectedId = targetId;
  markDirty();
  renderActionList();
  renderEditor();
  requestVisibleContentMeasurements();
}

function applyImportedEffectImage(result, targetId) {
  const action = state.actions.find((candidate) => candidate._uiId === targetId);
  if (!action) return;
  action.effect ||= {
    file: '',
    intervalMs: 450,
    size: 32,
    lifetimeMs: 1800,
    offsetX: 0,
    offsetY: 12,
    coordinateVersion: 2,
    emitWhileStill: false,
  };
  action.effect.file = result.relativePath;
  action.effect._assetUrl = result.assetUrl;
  state.selectedId = targetId;
  markDirty();
  renderEditor();
}

const SIZE_MEASUREMENT_CACHE_TTL_MS = 6000;
const SIZE_MEASUREMENT_CACHE_LIMIT = 100;
const sizeMeasurementCache = new Map();

function loadSizeMeasurementImage(source, timeoutMs = SIZE_MEASUREMENT_CACHE_TTL_MS) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const timer = window.setTimeout(() => finish(new Error('画像の測定が時間切れになりました。')), timeoutMs);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve(image);
    };
    image.onload = () => finish();
    image.onerror = () => finish(new Error('画像を測定できませんでした。'));
    image.src = source;
  });
}

async function measureVisibleContent(source, versionKey = source) {
  const cacheKey = `${source}|${String(versionKey || source)}`;
  const now = Date.now();
  const cached = sizeMeasurementCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    sizeMeasurementCache.delete(cacheKey);
    sizeMeasurementCache.set(cacheKey, cached);
    return cached.promise;
  }
  if (cached) sizeMeasurementCache.delete(cacheKey);

  const promise = (async () => {
    const image = await loadSizeMeasurementImage(source);
    const naturalWidth = Math.max(1, image.naturalWidth || image.width || 1);
    const naturalHeight = Math.max(1, image.naturalHeight || image.height || 1);
    const maximumDimension = 320;
    const renderScale = Math.min(1, maximumDimension / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * renderScale));
    const height = Math.max(1, Math.round(naturalHeight * renderScale));
    const maximumRenderedDimension = Math.max(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    let minX = 0;
    let minY = 0;
    let maxX = width - 1;
    let maxY = height - 1;

    try {
      const pixels = context.getImageData(0, 0, width, height).data;
      minX = width;
      minY = height;
      maxX = -1;
      maxY = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (pixels[(y * width + x) * 4 + 3] > 12) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }
      if (maxX < minX || maxY < minY) {
        minX = 0;
        minY = 0;
        maxX = width - 1;
        maxY = height - 1;
      }
    } catch (_error) {
      // If a local image cannot be sampled, its full rectangle is used instead.
    }

    const visibleWidth = maxX - minX + 1;
    const visibleHeight = maxY - minY + 1;
    const imageFrameWidth = width / maximumRenderedDimension;
    const imageFrameHeight = height / maximumRenderedDimension;
    const imageLeft = (1 - imageFrameWidth) / 2;
    const imageTop = (1 - imageFrameHeight) / 2;

    return {
      baseWidth: visibleWidth / maximumRenderedDimension,
      baseHeight: visibleHeight / maximumRenderedDimension,
      centerX: imageLeft + ((minX + maxX + 1) / 2) / maximumRenderedDimension,
      centerY: imageTop + ((minY + maxY + 1) / 2) / maximumRenderedDimension,
    };
  })();

  const entry = { promise, expiresAt: now + SIZE_MEASUREMENT_CACHE_TTL_MS };
  sizeMeasurementCache.set(cacheKey, entry);
  while (sizeMeasurementCache.size > SIZE_MEASUREMENT_CACHE_LIMIT) {
    sizeMeasurementCache.delete(sizeMeasurementCache.keys().next().value);
  }

  try {
    return await promise;
  } catch (error) {
    if (sizeMeasurementCache.get(cacheKey) === entry) sizeMeasurementCache.delete(cacheKey);
    throw error;
  }
}

function actionMeasurementKey(action) {
  return `${action?.file || ''}|${action?._assetUrl || ''}`;
}

async function getActionMeasurement(action) {
  const key = actionMeasurementKey(action);
  const current = actionMeasurements.get(action._uiId);
  if (current?.key === key) {
    if (current.status === 'ready') return current.measurement;
    if (current.promise) return current.promise;
    if (current.status === 'error') throw current.error;
  }

  const entry = { key, status: 'pending', measurement: null, error: null, promise: null };
  actionMeasurements.set(action._uiId, entry);
  entry.promise = (async () => {
    const metadata = await window.mascotAPI.getAssetMetadata(action.file);
    return measureVisibleContent(
      action._assetUrl,
      metadata?.cacheKey || `${metadata?.size || 0}:${metadata?.mtimeMs || 0}`,
    );
  })();
  try {
    const measurement = await entry.promise;
    if (actionMeasurements.get(action._uiId) === entry) {
      entry.status = 'ready';
      entry.measurement = measurement;
      entry.promise = null;
    }
    return measurement;
  } catch (error) {
    if (actionMeasurements.get(action._uiId) === entry) {
      entry.status = 'error';
      entry.error = error;
      entry.promise = null;
    }
    throw error;
  }
}

function requestVisibleContentMeasurements() {
  if (!state.apiAvailable) return;
  measurementQueueRequested = true;
  if (measurementQueueRunning) return;
  measurementQueueRunning = true;

  void (async () => {
    while (measurementQueueRequested) {
      measurementQueueRequested = false;
      const actionsWithImages = state.actions.filter((action) => action._assetUrl);
      const activeIds = new Set(actionsWithImages.map((action) => action._uiId));
      for (const [id, entry] of actionMeasurements) {
        const action = actionsWithImages.find((candidate) => candidate._uiId === id);
        if (!activeIds.has(id) || entry.key !== actionMeasurementKey(action)) actionMeasurements.delete(id);
      }
      await mapWithConcurrency(actionsWithImages, 4, async (action) => {
        try {
          await getActionMeasurement(action);
        } catch (error) {
          console.warn(`「${action.name || '画像'}」を測定できませんでした。`, error);
        }
      });
    }
  })().then(() => {
    renderActionList();
    renderEditor();
    if (activeImageEditor) {
      const action = state.actions.find((candidate) => candidate._uiId === activeImageEditor.actionId);
      updateClippingStatus(
        elements.imageEditorClippingStatus,
        action,
        activeImageEditor.transform,
        { explainClipping: true },
      );
    }
  }).catch((error) => {
    console.error('画像の見た目を測定できませんでした。', error);
  }).finally(() => {
    measurementQueueRunning = false;
    if (measurementQueueRequested) requestVisibleContentMeasurements();
  });
}

function openSizeManager() {
  const actionsWithImages = state.actions.filter((action) => action._assetUrl);
  if (actionsWithImages.length === 0) {
    showError('先にキャラクター画像を1枚以上追加してください。');
    return;
  }
  const generation = beginSizeManagerGeneration();
  const working = new Map(
    state.actions.map((action) => [action._uiId, normalizeImageTransform(action.imageTransform)]),
  );
  const measurements = new Map();
  const initialMascotSize = clamp(
    Math.round(numberOr(state.config?.mascot?.size, 180)),
    SETTINGS_RULES.mascotSize.minimum,
    SETTINGS_RULES.mascotSize.maximum,
  );
  const screen = window.screen || {};
  const availableWidth = Math.max(1, Math.round(Number(screen.availWidth) || Number(window.innerWidth) || 1024));
  const availableHeight = Math.max(1, Math.round(Number(screen.availHeight) || Number(window.innerHeight) || 768));
  const shortSide = Math.min(availableWidth, availableHeight);
  const maximumDisplaySize = Math.min(
    Math.max(1, availableWidth - SAFE_EDGE_INSET * 2),
    Math.max(1, availableHeight - SAFE_EDGE_INSET * 2),
  );
  const effectsAtOpen = new Map(
    state.actions
      .filter((action) => action.effect)
      .map((action) => [action._uiId, {
        size: numberOr(action.effect.size, 32),
        offsetX: numberOr(action.effect.offsetX, 0),
        offsetY: numberOr(action.effect.offsetY, 12),
      }]),
  );
  let referenceId = actionsWithImages.some((action) => action._uiId === state.selectedId)
    ? state.selectedId
    : actionsWithImages[0]._uiId;
  let workingMascotSize = initialMascotSize;
  let targetSize = null;
  let alignmentRange = null;
  const cardMetrics = new Map();
  const formatDecimal = (value) => String(Number(value.toFixed(1)));
  const formatPercent = (value) => `${formatDecimal(value)}%`;

  const placeDiagramBox = (box) => {
    box.style.left = '';
    box.style.right = '';
    box.style.top = '';
    box.style.bottom = '';
    box.style.transform = '';
    const position = state.config?.mascot?.startPosition || 'bottom-right';
    const anchors = {
      'top-left': { left: '0', top: '0' },
      'top-right': { right: '0', top: '0' },
      'bottom-left': { left: '0', bottom: '0' },
      'bottom-right': { right: '0', bottom: '0' },
      center: { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' },
    };
    Object.assign(box.style, anchors[position] || anchors['bottom-right']);
  };

  const updateScreenDiagram = () => {
    const diagramSize = Math.min(workingMascotSize, maximumDisplaySize);
    const percentage = formatPercent(workingMascotSize / availableHeight * 100);
    const limitedNote = workingMascotSize > maximumDisplaySize
      ? ` 画面に収まる表示は${maximumDisplaySize}pxです。`
      : '';
    elements.sizeManagerScreenDiagram.style.aspectRatio = `${availableWidth} / ${availableHeight}`;
    elements.sizeManagerScreenDiagram.setAttribute(
      'aria-label',
      `画面の高さの ${percentage} の大きさです。${limitedNote}`,
    );
    elements.sizeManagerScreenDiagramCaption.textContent = `画面の高さの ${percentage}`;
    for (const [box, size] of [
      [elements.sizeManagerScreenDiagramMaximum, maximumDisplaySize],
      [elements.sizeManagerScreenDiagramMascot, diagramSize],
    ]) {
      box.style.width = `${size / availableWidth * 100}%`;
      box.style.height = `${size / availableHeight * 100}%`;
      placeDiagramBox(box);
    }
  };

  const visualMetric = (action) => {
    const measurement = measurements.get(action._uiId);
    const transform = working.get(action._uiId);
    if (!transform) return '見た目を測定中…';
    const position = `位置：横 ${formatImageOffset(transform.offsetX)}%・縦 ${formatImageOffset(transform.offsetY)}%`;
    if (!measurement) return `見た目を測定中…・${position}`;
    const adjustedMeasurement = measurementForTransform(measurement, transform);
    const width = Math.round(adjustedMeasurement.baseWidth * transform.scale * 100);
    const height = Math.round(adjustedMeasurement.baseHeight * transform.scale * 100);
    const effectiveMascotSize = Math.min(workingMascotSize, maximumDisplaySize);
    const actualPixels = Math.round(
      Math.max(adjustedMeasurement.baseWidth, adjustedMeasurement.baseHeight)
        * transform.scale * effectiveMascotSize,
    );
    return `見た目：幅 ${width}% × 高さ ${height}%・${position}・実際の画面：約 ${actualPixels}px`;
  };

  const updateCardMetrics = () => {
    for (const action of state.actions) {
      const metrics = cardMetrics.get(action._uiId);
      if (metrics) metrics.textContent = visualMetric(action);
    }
  };

  const syncMascotSizeControls = (source = null) => {
    elements.sizeManagerMascotSlider.value = String(workingMascotSize);
    elements.sizeManagerMascotOutput.textContent = `${workingMascotSize} px`;
    if (source !== 'size') elements.sizeManagerMascotSize.value = String(workingMascotSize);
    if (source !== 'percent') {
      elements.sizeManagerScreenPercent.value = formatDecimal(workingMascotSize / availableHeight * 100);
    }
    elements.sizeManagerSizeWarning.hidden = workingMascotSize <= maximumDisplaySize;
    elements.sizeManagerSizeWarning.textContent = `画面に収まらないため、${maximumDisplaySize}pxに縮めて表示されます。`;
    updateScreenDiagram();
    updateCardMetrics();
  };

  const setWorkingMascotSize = (value, source = null) => {
    if (String(value).trim() === '') return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const pixels = source === 'percent' ? parsed * availableHeight / 100 : parsed;
    workingMascotSize = clamp(
      Math.round(pixels),
      SETTINGS_RULES.mascotSize.minimum,
      SETTINGS_RULES.mascotSize.maximum,
    );
    syncMascotSizeControls(source);
  };

  const syncTargetControls = (source = null) => {
    if (!Number.isFinite(targetSize)) return;
    const value = formatDecimal(targetSize * 100);
    elements.sizeManagerTargetSlider.value = value;
    elements.sizeManagerTargetOutput.textContent = `${value}%`;
    if (source !== 'percent') elements.sizeManagerTargetPercent.value = value;
  };

  const setTargetSize = (value, source = null) => {
    if (String(value).trim() === '') return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const target = parsed / 100;
    targetSize = alignmentRange?.valid
      ? clamp(target, alignmentRange.minimum, alignmentRange.maximum)
      : clamp(target, 0, FRAME_FIT_LIMIT);
    syncTargetControls(source);
  };

  const updateTargetFromReference = () => {
    const measurement = measurements.get(referenceId);
    const transform = working.get(referenceId);
    if (!measurement || !transform) return;
    const referenceSize = Math.max(measurement.baseWidth, measurement.baseHeight) * transform.scale;
    targetSize = alignmentRange?.valid
      ? clamp(referenceSize, alignmentRange.minimum, alignmentRange.maximum)
      : clamp(referenceSize, 0, FRAME_FIT_LIMIT);
    syncTargetControls();
  };

  const calculateAlignmentRange = () => {
    const measured = actionsWithImages
      .map((action) => ({
        action,
        baseSize: Math.max(
          measurements.get(action._uiId)?.baseWidth || 0,
          measurements.get(action._uiId)?.baseHeight || 0,
        ),
      }))
      .filter((entry) => entry.baseSize > 0);
    if (measured.length === 0) return null;

    const lower = measured.reduce((current, entry) => (
      entry.baseSize * SETTINGS_RULES.imageScale.minimum > current.baseSize * SETTINGS_RULES.imageScale.minimum
        ? entry
        : current
    ));
    const upper = measured.reduce((current, entry) => (
      entry.baseSize * SETTINGS_RULES.imageScale.maximum < current.baseSize * SETTINGS_RULES.imageScale.maximum
        ? entry
        : current
    ));
    const minimum = lower.baseSize * SETTINGS_RULES.imageScale.minimum;
    const upperByImage = upper.baseSize * SETTINGS_RULES.imageScale.maximum;
    const rawMaximum = Math.min(FRAME_FIT_LIMIT, upperByImage);
    const valid = minimum <= rawMaximum + 1e-9;
    return {
      minimum,
      maximum: valid ? Math.max(minimum, rawMaximum) : rawMaximum,
      valid,
      lowerAction: lower.action,
      upperAction: upperByImage < FRAME_FIT_LIMIT ? upper.action : null,
    };
  };

  const renderAlignmentRange = () => {
    if (!alignmentRange) {
      elements.sizeManagerRangeStatus.textContent = '画像の見た目を測定できませんでした。';
      elements.sizeManagerTargetSlider.disabled = true;
      elements.sizeManagerTargetPercent.disabled = true;
      elements.sizeManagerAuto.disabled = !measurements.has(referenceId);
      return;
    }

    const rangeText = `揃えられる範囲：${formatDecimal(alignmentRange.minimum * 100)}〜${formatDecimal(alignmentRange.maximum * 100)}%`;
    const lowerName = alignmentRange.lowerAction.name || '名前のない画像';
    const upperReason = alignmentRange.upperAction
      ? `「${alignmentRange.upperAction.name || '名前のない画像'}」の上限`
      : `枠に収める上限（${formatPercent(FRAME_FIT_LIMIT * 100)}%）`;
    elements.sizeManagerRangeStatus.textContent = alignmentRange.valid
      ? rangeText
      : `${rangeText}。範囲が成立しません：「${lowerName}」の下限が${upperReason}を超えています。`;
    elements.sizeManagerRangeStatus.classList.toggle('is-error', !alignmentRange.valid);
    elements.sizeManagerTargetSlider.disabled = !alignmentRange.valid;
    elements.sizeManagerTargetPercent.disabled = !alignmentRange.valid;
    if (alignmentRange.valid) {
      const minimum = formatDecimal(alignmentRange.minimum * 100);
      const maximum = formatDecimal(alignmentRange.maximum * 100);
      elements.sizeManagerTargetSlider.min = minimum;
      elements.sizeManagerTargetSlider.max = maximum;
      elements.sizeManagerTargetPercent.min = minimum;
      elements.sizeManagerTargetPercent.max = maximum;
    }
    updateTargetFromReference();
    elements.sizeManagerAuto.disabled = !measurements.has(referenceId);
  };

  const updateFitClippedButton = () => {
    elements.sizeManagerFitClipped.disabled = !actionsWithImages.some((action) => (
      measurements.has(action._uiId)
      && hasFrameIssue(computeClipping(measurements.get(action._uiId), working.get(action._uiId)))
    ));
  };

  const renderCards = () => {
    elements.sizeManagerGrid.replaceChildren();
    cardMetrics.clear();

    for (const action of state.actions) {
      const card = document.createElement('article');
      const header = document.createElement('label');
      const radio = document.createElement('input');
      const title = document.createElement('span');
      const preview = document.createElement('div');
      const controls = document.createElement('div');
      const controlLabel = document.createElement('label');
      const controlText = document.createElement('span');
      const controlOutput = document.createElement('output');
      const slider = document.createElement('input');
      const metrics = document.createElement('p');
      const clippingWarning = document.createElement('p');
      const transform = working.get(action._uiId);

      card.className = 'size-card';
      card.classList.toggle('is-reference', action._uiId === referenceId);
      header.className = 'size-card-header';
      radio.type = 'radio';
      radio.name = 'size-reference';
      radio.checked = action._uiId === referenceId;
      radio.disabled = !action._assetUrl;
      radio.setAttribute('aria-label', `${action.name || 'この画像'}を大きさの基準にする`);
      radio.addEventListener('change', () => {
        referenceId = action._uiId;
        elements.sizeManagerStatus.textContent = `「${action.name || '画像'}」を基準に選びました。`;
        updateTargetFromReference();
        renderCards();
      });
      title.className = 'size-card-title';
      title.textContent = action.name || '名前のない動作';
      title.title = title.textContent;
      header.append(radio, title);

      preview.className = 'size-card-preview';
      if (action._assetUrl) {
        const image = document.createElement('img');
        image.src = action._assetUrl;
        image.alt = `${action.name || '動作'}の表示サイズ`;
        applyImageTransform(image, transform);
        preview.appendChild(image);
        attachImagePan(preview, transform, () => {
          applyImageTransform(image, transform);
          metrics.textContent = visualMetric(action);
          updateClippingWarning();
          updateFitClippedButton();
        });
      } else {
        preview.textContent = '画像未登録';
      }

      controls.className = 'size-card-controls';
      controlText.textContent = '表示倍率';
      controlOutput.textContent = `${Math.round(transform.scale * 100)}%`;
      controlLabel.append(controlText, controlOutput);
      slider.type = 'range';
      slider.min = '0.3';
      slider.max = '3';
      slider.step = '0.01';
      slider.value = String(transform.scale);
      slider.disabled = !action._assetUrl;
      clippingWarning.className = 'size-card-clipping-warning';
      clippingWarning.textContent = '⚠';
      clippingWarning.hidden = true;
      const updateClippingWarning = () => {
        const measurement = measurements.get(action._uiId);
        const clipping = measurement ? computeClipping(measurement, transform) : null;
        clippingWarning.hidden = !hasFrameIssue(clipping);
        clippingWarning.textContent = clipping?.clipped ? '⚠ 見切れ' : '⚠ ぎりぎり';
      };
      metrics.className = 'size-card-metrics';
      metrics.textContent = visualMetric(action);
      cardMetrics.set(action._uiId, metrics);
      slider.addEventListener('input', () => {
        transform.scale = clamp(numberOr(slider.value, 1), 0.3, 3);
        controlOutput.textContent = `${Math.round(transform.scale * 100)}%`;
        const image = preview.querySelector('img');
        if (image) applyImageTransform(image, transform);
        metrics.textContent = visualMetric(action);
        updateClippingWarning();
        updateFitClippedButton();
      });
      controls.append(controlLabel, slider, metrics);
      card.append(header, preview, controls, clippingWarning);
      elements.sizeManagerGrid.appendChild(card);
      updateClippingWarning();
    }
    updateFitClippedButton();
  };

  const closeDialog = () => {
    invalidateSizeManagerGeneration(generation);
    if (elements.sizeManagerDialog.open) elements.sizeManagerDialog.close();
  };

  elements.sizeManagerMaxInfo.textContent = `最大 ${maximumDisplaySize}px`;
  elements.sizeManagerMaxMarker.style.left = `${clamp(
    (maximumDisplaySize - SETTINGS_RULES.mascotSize.minimum)
      / (SETTINGS_RULES.mascotSize.maximum - SETTINGS_RULES.mascotSize.minimum) * 100,
    0,
    100,
  )}%`;
  elements.sizeManagerScaleEffects.checked = true;
  elements.sizeManagerMascotSlider.oninput = () => setWorkingMascotSize(elements.sizeManagerMascotSlider.value, 'slider');
  elements.sizeManagerMascotSize.oninput = () => setWorkingMascotSize(elements.sizeManagerMascotSize.value, 'size');
  elements.sizeManagerMascotSize.onchange = () => {
    setWorkingMascotSize(elements.sizeManagerMascotSize.value, 'size');
    elements.sizeManagerMascotSize.value = String(workingMascotSize);
  };
  elements.sizeManagerScreenPercent.oninput = () => setWorkingMascotSize(elements.sizeManagerScreenPercent.value, 'percent');
  elements.sizeManagerScreenPercent.onchange = () => {
    setWorkingMascotSize(elements.sizeManagerScreenPercent.value, 'percent');
    elements.sizeManagerScreenPercent.value = formatDecimal(workingMascotSize / availableHeight * 100);
  };
  elements.sizeManagerTargetSlider.oninput = () => setTargetSize(elements.sizeManagerTargetSlider.value, 'slider');
  elements.sizeManagerTargetPercent.oninput = () => setTargetSize(elements.sizeManagerTargetPercent.value, 'percent');
  elements.sizeManagerTargetPercent.onchange = () => {
    setTargetSize(elements.sizeManagerTargetPercent.value, 'percent');
    elements.sizeManagerTargetPercent.value = formatDecimal(targetSize * 100);
  };
  syncMascotSizeControls();
  elements.sizeManagerAuto.disabled = true;
  elements.sizeManagerFitClipped.disabled = true;
  elements.sizeManagerStatus.textContent = '測定中…';
  elements.sizeManagerRangeStatus.textContent = '測定中…';
  elements.sizeManagerRangeStatus.classList.remove('is-error');
  elements.sizeManagerTargetSlider.disabled = true;
  elements.sizeManagerTargetPercent.disabled = true;
  targetSize = null;
  renderCards();
  elements.sizeManagerDialog.showModal();

  mapWithConcurrency(actionsWithImages, 4, async (action) => {
    try {
      const measurement = await getActionMeasurement(action);
      if (!isSizeManagerGenerationCurrent(generation)) return;
      measurements.set(action._uiId, measurement);
    } catch (error) {
      console.warn(error);
    }
  }).then(() => {
    if (!isSizeManagerGenerationCurrent(generation) || !elements.sizeManagerDialog.open) return;
    elements.sizeManagerStatus.textContent = `${measurements.size} 枚を測定しました。`;
    alignmentRange = calculateAlignmentRange();
    renderAlignmentRange();
    renderCards();
  });

  elements.sizeManagerAuto.onclick = () => {
    if (!isSizeManagerGenerationCurrent(generation)) return;
    const referenceAction = state.actions.find((action) => action._uiId === referenceId);
    const referenceMeasurement = measurements.get(referenceId);
    const referenceTransform = working.get(referenceId);
    if (!referenceAction || !referenceMeasurement || !referenceTransform) {
      showError('基準画像の測定が終わってから、もう一度押してください。');
      return;
    }

    const target = clamp(Number.isFinite(targetSize)
      ? targetSize
      : Math.max(referenceMeasurement.baseWidth, referenceMeasurement.baseHeight) * referenceTransform.scale,
    0,
    FRAME_FIT_LIMIT);
    for (const action of actionsWithImages) {
      const measurement = measurements.get(action._uiId);
      if (!measurement) continue;
      const current = working.get(action._uiId);
      const baseSize = Math.max(measurement.baseWidth, measurement.baseHeight);
      const scale = clamp(target / Math.max(0.001, baseSize), 0.3, 3);
      current.scale = scale;
      const adjustedMeasurement = measurementForTransform(measurement, current);
      current.offsetX = clamp(-100 * scale * (adjustedMeasurement.centerX - 0.5), -100, 100);
      current.offsetY = clamp(-100 * scale * (adjustedMeasurement.centerY - 0.5), -100, 100);
      Object.assign(current, fitTransformToFrame(measurement, current));
    }
    elements.sizeManagerStatus.textContent = `見た目の大きさを${formatPercent(target * 100)}に、できる範囲で揃えました。`;
    renderCards();
  };

  elements.sizeManagerFitClipped.onclick = () => {
    if (!isSizeManagerGenerationCurrent(generation)) return;
    let fixedCount = 0;
    for (const action of actionsWithImages) {
      const measurement = measurements.get(action._uiId);
      const transform = working.get(action._uiId);
      if (!measurement || !hasFrameIssue(computeClipping(measurement, transform))) continue;
      working.set(action._uiId, fitTransformToFrame(measurement, transform));
      fixedCount += 1;
    }
    renderCards();
    elements.sizeManagerStatus.textContent = `${fixedCount} 枚の画像を枠に収めました。`;
  };

  elements.sizeManagerCancel.onclick = closeDialog;
  elements.sizeManagerClose.onclick = closeDialog;
  elements.sizeManagerDialog.oncancel = (event) => {
    event.preventDefault();
    closeDialog();
  };
  const applyWorkingSettings = () => {
    state.config.mascot.size = workingMascotSize;
    const scaleEffects = elements.sizeManagerScaleEffects.checked;
    const effectRatio = workingMascotSize / initialMascotSize;
    for (const action of state.actions) {
      action.imageTransform = normalizeImageTransform(working.get(action._uiId));
      const originalEffect = effectsAtOpen.get(action._uiId);
      if (!scaleEffects || !originalEffect || !action.effect) continue;
      action.effect.size = clamp(
        Math.round(originalEffect.size * effectRatio),
        SETTINGS_RULES.effectSize.minimum,
        SETTINGS_RULES.effectSize.maximum,
      );
      action.effect.offsetX = clamp(
        Math.round(originalEffect.offsetX * effectRatio),
        SETTINGS_RULES.effectOffset.minimum,
        SETTINGS_RULES.effectOffset.maximum,
      );
      action.effect.offsetY = clamp(
        Math.round(originalEffect.offsetY * effectRatio),
        SETTINGS_RULES.effectOffset.minimum,
        SETTINGS_RULES.effectOffset.maximum,
      );
    }
    markDirty();
    closeDialog();
    renderAll();
  };
  elements.sizeManagerSave.onclick = async () => {
    if (!isSizeManagerGenerationCurrent(generation)) return;
    applyWorkingSettings();
    await saveConfiguration();
  };
}

function openImageEditor() {
  const action = selectedAction();
  if (!action?._assetUrl) {
    showError('先にキャラクター画像を追加してください。');
    return;
  }

  const working = normalizeImageTransform(action.imageTransform);
  activeImageEditor = { actionId: action._uiId, transform: working };
  elements.imageEditorPreview.src = action._assetUrl;

  const updatePreview = () => {
    working.flipX = elements.imageEditorFlipX.checked;
    working.scale = clamp(numberOr(elements.imageScale.value, 1), 0.3, 3);
    working.offsetX = clamp(numberOr(elements.imageOffsetX.value, 0), -100, 100);
    working.offsetY = clamp(numberOr(elements.imageOffsetY.value, 0), -100, 100);
    elements.imageScaleOutput.textContent = `${Math.round(working.scale * 100)}%`;
    elements.imageOffsetXOutput.textContent = formatImageOffset(working.offsetX);
    elements.imageOffsetYOutput.textContent = formatImageOffset(working.offsetY);
    applyImageTransform(elements.imageEditorPreview, working);
    updateClippingStatus(
      elements.imageEditorClippingStatus,
      action,
      working,
      { explainClipping: true },
    );
  };

  const setControls = (transform) => {
    elements.imageEditorFlipX.checked = transform.flipX;
    elements.imageScale.value = String(transform.scale);
    elements.imageOffsetX.value = String(transform.offsetX);
    elements.imageOffsetY.value = String(transform.offsetY);
    updatePreview();
  };

  const closeDialog = () => {
    if (activeImageEditor?.actionId === action._uiId) activeImageEditor = null;
    if (elements.imageEditorDialog.open) elements.imageEditorDialog.close();
  };

  elements.imageScale.oninput = updatePreview;
  elements.imageOffsetX.oninput = updatePreview;
  elements.imageOffsetY.oninput = updatePreview;
  elements.imageEditorFlipX.onchange = updatePreview;
  elements.imageEditorReset.onclick = () => setControls(normalizeImageTransform());
  elements.imageEditorCancel.onclick = closeDialog;
  elements.imageEditorClose.onclick = closeDialog;
  elements.imageEditorApply.onclick = () => {
    action.imageTransform = normalizeImageTransform(working);
    markDirty();
    closeDialog();
    renderActionList();
    renderEditor();
    showToast('画像のトリミングと大きさを反映しました。');
  };
  elements.imageEditorDialog.oncancel = (event) => {
    event.preventDefault();
    closeDialog();
  };

  attachImagePan(elements.imageEditorFrame, working, () => {
    elements.imageOffsetX.value = String(working.offsetX);
    elements.imageOffsetY.value = String(working.offsetY);
    updatePreview();
  });
  setControls(working);
  elements.imageEditorDialog.showModal();
}

function assertEditableNumber(value, fallback, label, rule) {
  const number = readNumberInput(value, fallback);
  if (!Number.isFinite(number)) throw new Error(`${label}を入力してください。`);
  if (
    number < rule.minimum
    || number > rule.maximum
    || (rule.integer && !Number.isInteger(number))
  ) {
    const kind = rule.integer ? '整数' : '数値';
    throw new Error(`${label}は${rule.minimum}〜${rule.maximum}の${kind}にしてください。`);
  }
  return number;
}

function validateEditableStateForSave() {
  const mascot = state.config?.mascot || {};
  assertEditableNumber(mascot.size, 180, '表示サイズ', SETTINGS_RULES.mascotSize);
  assertEditableNumber(mascot.margin, 40, '画面端の余白', SETTINGS_RULES.margin);
  if (!ALLOWED_START_POSITIONS.has(mascot.startPosition || 'bottom-right')) {
    throw new Error('最初の位置が対応していません。');
  }
  if (state.actions.length > 100) throw new Error('動作は100件以下にしてください。');

  state.actions.forEach((action, index) => {
    const label = `動作${index + 1}`;
    assertEditableNumber(action.weight, 1, `${label}の選ばれやすさ`, SETTINGS_RULES.weight);
    const duration = Array.isArray(action.durationMs) ? action.durationMs : DEFAULT_DURATION_MS;
    const minimum = assertEditableNumber(
      Math.round(readNumberInput(duration[0], DEFAULT_DURATION_MS[0])),
      DEFAULT_DURATION_MS[0],
      `${label}の最短時間`,
      SETTINGS_RULES.durationMs,
    );
    const maximum = assertEditableNumber(
      Math.round(readNumberInput(duration[1], DEFAULT_DURATION_MS[1])),
      DEFAULT_DURATION_MS[1],
      `${label}の最長時間`,
      SETTINGS_RULES.durationMs,
    );
    if (minimum > maximum) throw new Error(`${label}の最短時間は最長時間以下にしてください。`);
    if (!ALLOWED_FLIPS.has(action.flipMode || 'direction')) throw new Error(`${label}の反転設定が対応していません。`);
    const transform = action.imageTransform || {};
    if (transform.flipX !== undefined && typeof transform.flipX !== 'boolean') {
      throw new Error(`${label}の画像反転設定はtrueまたはfalseにしてください。`);
    }
    assertEditableNumber(transform.scale, 1, `${label}の画像倍率`, SETTINGS_RULES.imageScale);
    assertEditableNumber(transform.offsetX, 0, `${label}の画像横位置`, SETTINGS_RULES.imageOffset);
    assertEditableNumber(transform.offsetY, 0, `${label}の画像縦位置`, SETTINGS_RULES.imageOffset);
    const movement = action.movement || {};
    if (!ALLOWED_MOVEMENTS.has(movement.type || 'still')) throw new Error(`${label}の動き方が対応していません。`);
    assertEditableNumber(movement.speed, 0, `${label}の速さ`, SETTINGS_RULES.movementSpeed);
    if (action.effect) {
      assertEditableNumber(
        Math.round(readNumberInput(action.effect.intervalMs, 450)),
        450,
        `${label}のエフェクト間隔`,
        SETTINGS_RULES.effectIntervalMs,
      );
      assertEditableNumber(action.effect.size, 32, `${label}のエフェクトサイズ`, SETTINGS_RULES.effectSize);
      assertEditableNumber(
        Math.round(readNumberInput(action.effect.lifetimeMs, 1800)),
        1800,
        `${label}のエフェクト表示時間`,
        SETTINGS_RULES.effectLifetimeMs,
      );
      assertEditableNumber(action.effect.offsetX, 0, `${label}のエフェクト横位置`, SETTINGS_RULES.effectOffset);
      assertEditableNumber(action.effect.offsetY, 12, `${label}のエフェクト縦位置`, SETTINGS_RULES.effectOffset);
    }
  });
}

function serializeConfig() {
  if (!state.config) throw new Error('設定を読み込めていません。');
  if (state.actions.length === 0) throw new Error('動作を1件以上追加してください。');
  if (state.actions.length > MAX_ACTIONS) throw new Error(`動作は${MAX_ACTIONS}件までにしてください。`);
  validateEditableStateForSave();

  const actions = state.actions.map((action, index) => {
    const name = String(action.name || '').trim();
    if (!name) throw new Error(`動作${index + 1}に名前を付けてください。`);
    if (!action.file) throw new Error(`「${name}」へキャラクター画像を追加してください。`);

    const result = {
      name,
      file: action.file,
      weight: positiveWeight(action.weight, 1),
      durationMs: [
        Math.round(numberOr(action.durationMs?.[0], DEFAULT_DURATION_MS[0])),
        Math.round(numberOr(action.durationMs?.[1], DEFAULT_DURATION_MS[1])),
      ],
      flipMode: ['direction', 'none', 'random'].includes(action.flipMode) ? action.flipMode : 'direction',
      imageTransform: normalizeImageTransform(action.imageTransform),
      movement: {
        type: action.movement?.type || 'still',
        speed: numberOr(action.movement?.speed, 0),
      },
    };

    if (action.effect) {
      if (!action.effect.file) throw new Error(`「${name}」へエフェクト画像を追加するか、エフェクトをOFFにしてください。`);
      result.effect = {
        file: action.effect.file,
        intervalMs: Math.round(numberOr(action.effect.intervalMs, 450)),
        size: numberOr(action.effect.size, 32),
        lifetimeMs: Math.round(numberOr(action.effect.lifetimeMs, 1800)),
        offsetX: numberOr(action.effect.offsetX, 0),
        offsetY: numberOr(action.effect.offsetY, 12),
        coordinateVersion: 2,
        emitWhileStill: Boolean(action.effect.emitWhileStill),
      };
    }

    return result;
  });

  return {
    name: String(state.config.name || 'マスコット').trim() || 'マスコット',
    mascot: {
      size: numberOr(state.config.mascot.size, 180),
      startPosition: state.config.mascot.startPosition || 'bottom-right',
      margin: numberOr(state.config.mascot.margin, 40),
      rememberPosition: state.config.mascot.rememberPosition !== false,
    },
    actions,
  };
}

function applyNormalizedConfigToState(config) {
  const previousActions = state.actions;
  const selectedIndex = Math.max(
    0,
    previousActions.findIndex((action) => action._uiId === state.selectedId),
  );

  state.config = {
    ...config,
    mascot: {
      size: 180,
      startPosition: 'bottom-right',
      margin: 40,
      rememberPosition: true,
      ...(config.mascot || {}),
    },
  };
  state.actions = (config.actions || []).map((action, index) => {
    const previous = previousActions[index];
    const assetUrl = previous?.file === action.file ? previous._assetUrl : null;
    const effect = action.effect
      ? {
          ...action.effect,
          _assetUrl: previous?.effect?.file === action.effect.file
            ? previous.effect._assetUrl
            : null,
        }
      : undefined;

    return {
      ...action,
      imageTransform: normalizeImageTransform(action.imageTransform),
      _uiId: previous?._uiId || newId(),
      _assetUrl: assetUrl,
      movement: { type: 'still', speed: 0, ...(action.movement || {}) },
      durationMs: Array.isArray(action.durationMs) ? action.durationMs : [...DEFAULT_DURATION_MS],
      ...(effect ? { effect } : {}),
    };
  });
  state.selectedId = state.actions[Math.min(selectedIndex, state.actions.length - 1)]?._uiId || null;
  renderAll();
}

function markApplyRetry(message) {
  state.dirty = true;
  window.mascotAPI.reportDirtyState(true);
  elements.saveState.textContent = '保存済み・反映を再試行';
  elements.saveState.classList.add('is-dirty');
  elements.saveState.classList.remove('is-saved');
  elements.feedback.textContent = message;
  elements.feedback.classList.add('is-error');
  elements.saveButton.disabled = state.busy;
}

function markNewerChangesPending() {
  state.dirty = true;
  window.mascotAPI.reportDirtyState(true);
  elements.saveState.textContent = '新しい変更あり';
  elements.saveState.classList.add('is-dirty');
  elements.saveState.classList.remove('is-saved');
  elements.feedback.textContent = '保存中に新しい変更がありました。もう一度「保存して反映」を押してください。';
  elements.feedback.classList.remove('is-error');
  elements.saveButton.disabled = state.busy;
}

async function saveConfiguration() {
  if (!state.apiAvailable) {
    disableUnavailableEditor();
    return false;
  }
  const operation = beginOperation('save-configuration');
  if (!operation) return false;
  try {
    const payload = serializeConfig();
    const selectedIndex = Math.max(
      0,
      state.actions.findIndex((action) => action._uiId === state.selectedId),
    );
    const revisionAtStart = state.revision;
    elements.feedback.textContent = '保存し、マスコットへの反映を確認しています…';
    elements.feedback.classList.remove('is-error');
    const result = await window.mascotAPI.saveConfig(payload, selectedIndex);
    if (!result?.ok) throw new Error('保存に失敗しました。');

    if (state.revision !== revisionAtStart) {
      markNewerChangesPending();
      showToast('保存中に新しい変更が加わりました。もう一度保存してください。');
      return false;
    }

    applyNormalizedConfigToState(result.config || payload);
    if (!result.applied) {
      const message = `設定ファイルは保存しましたが、マスコットへの反映を確認できませんでした：${result.applyError || '応答がありません。'}`;
      markApplyRetry(message);
      showToast('反映を確認できませんでした。もう一度保存すると再試行できます。', true);
      return false;
    }

    markSaved();
    const actionLabel = result.actionName ? `「${result.actionName}」を表示して` : '';
    showToast(`設定を保存し、${actionLabel}マスコットへの反映を確認しました。`);
    return true;
  } catch (error) {
    console.error(error);
    showError(readableError(error));
    return false;
  } finally {
    endOperation(operation);
  }
}

async function prepareDistributionDefaults() {
  if (!state.apiAvailable) {
    disableUnavailableEditor();
    return false;
  }
  if (state.isPackaged) return false;
  if (state.dirty) {
    const saved = await saveConfiguration();
    if (!saved) return false;
  }

  const operation = beginOperation('prepare-distribution');
  if (!operation) return false;
  try {
    const result = await window.mascotAPI.prepareDistributionDefaults();
    if (!result?.ok) {
      throw new Error(result?.error || '配布用設定を準備できませんでした。');
    }
    showToast('現在の画像と設定を、配布版の初期状態へ反映しました。');
    elements.feedback.textContent = '配布版へ反映済みです。次はアプリをビルドできます。';
    return true;
  } catch (error) {
    console.error(error);
    showError(readableError(error));
    return false;
  } finally {
    endOperation(operation);
  }
}

elements.mascotName.addEventListener('input', () => {
  if (!state.config) return;
  state.config.name = elements.mascotName.value;
  markDirty();
});
elements.mascotSize.addEventListener('input', () => {
  if (!state.config?.mascot) return;
  state.config.mascot.size = numberOr(elements.mascotSize.value, 180);
  elements.mascotSizeOutput.textContent = `${elements.mascotSize.value} px`;
  markDirty();
  renderEffectLivePreview();
});
elements.startPosition.addEventListener('change', () => {
  if (!state.config?.mascot) return;
  state.config.mascot.startPosition = elements.startPosition.value;
  markDirty();
});
elements.rememberPosition.addEventListener('change', () => {
  if (!state.config?.mascot) return;
  state.config.mascot.rememberPosition = elements.rememberPosition.checked;
  markDirty();
});

elements.addAction.addEventListener('click', addAction);
elements.deleteAction.addEventListener('click', deleteSelectedAction);
elements.moveUp.addEventListener('click', () => moveSelectedAction(-1));
elements.moveDown.addEventListener('click', () => moveSelectedAction(1));
elements.actionName.addEventListener('input', updateActionName);
elements.actionWeight.addEventListener('change', () => {
  editSelectedAction((action) => {
    action.weight = readNumberInput(elements.actionWeight.value);
    if (Number.isFinite(action.weight)) elements.actionWeight.value = String(action.weight);
  });
  renderActionList();
});
elements.flipDirection.addEventListener('change', () => editSelectedAction((action) => {
  action.flipMode = elements.flipDirection.value;
}));
elements.imageFlipX.addEventListener('change', () => {
  editSelectedAction((action) => {
    action.imageTransform = normalizeImageTransform(action.imageTransform);
    action.imageTransform.flipX = elements.imageFlipX.checked;
  });
  renderActionList();
  renderEditor();
});
elements.durationMin.addEventListener('input', () => editSelectedAction((action) => {
  action.durationMs[0] = secondsToMs(elements.durationMin.value, DEFAULT_DURATION_MS[0] / 1000);
}));
elements.durationMax.addEventListener('input', () => editSelectedAction((action) => {
  action.durationMs[1] = secondsToMs(elements.durationMax.value, DEFAULT_DURATION_MS[1] / 1000);
}));
elements.movementType.addEventListener('change', () => {
  editSelectedAction((action) => {
    action.movement.type = elements.movementType.value;
    if (elements.movementType.value === 'still') action.movement.speed = 0;
    else if (numberOr(action.movement.speed, 0) === 0) action.movement.speed = 55;
  });
  renderActionList();
  renderEditor();
});
elements.movementSpeed.addEventListener('input', () => {
  editSelectedAction((action) => {
    action.movement.speed = readNumberInput(elements.movementSpeed.value);
  });
  elements.speedOutput.textContent = elements.movementSpeed.value;
});

elements.effectEnabled.addEventListener('change', () => {
  editSelectedAction((action) => {
    if (elements.effectEnabled.checked) {
      action.effect ||= {
        file: '',
        _assetUrl: null,
        intervalMs: 450,
        size: 32,
        lifetimeMs: 1800,
        offsetX: 0,
        offsetY: 12,
        coordinateVersion: 2,
        emitWhileStill: false,
      };
    } else {
      delete action.effect;
    }
  });
  renderEditor();
});
elements.effectInterval.addEventListener('input', () => {
  editSelectedAction((action) => {
    action.effect.intervalMs = secondsToMs(elements.effectInterval.value, 0.45);
  });
  renderEffectLivePreview();
});
elements.effectSize.addEventListener('input', () => {
  editSelectedAction((action) => {
    action.effect.size = readNumberInput(elements.effectSize.value);
  });
  renderEffectLivePreview();
});
elements.effectLifetime.addEventListener('input', () => {
  editSelectedAction((action) => {
    action.effect.lifetimeMs = secondsToMs(elements.effectLifetime.value, 1.8);
  });
  renderEffectLivePreview();
});
elements.effectOffsetX.addEventListener('input', () => {
  editSelectedAction((action) => {
    action.effect.offsetX = readNumberInput(elements.effectOffsetX.value);
  });
  renderEffectLivePreview();
});
elements.effectOffsetY.addEventListener('input', () => {
  editSelectedAction((action) => {
    action.effect.offsetY = readNumberInput(elements.effectOffsetY.value);
  });
  renderEffectLivePreview();
});
elements.effectWhileStill.addEventListener('change', () => editSelectedAction((action) => {
  action.effect.emitWhileStill = elements.effectWhileStill.checked;
}));

elements.openSizeManager.addEventListener('click', openSizeManager);
elements.openDurationBulk.addEventListener('click', openDurationBulkDialog);
elements.durationBulkCancel.addEventListener('click', () => elements.durationBulkDialog.close());
elements.durationBulkSave.addEventListener('click', () => applyDurationBulk());
elements.imageEditButton.addEventListener('click', openImageEditor);
setupDropzone(elements.actionDropzone, 'actions', applyImportedActionImage);
setupDropzone(elements.effectDropzone, 'effects', applyImportedEffectImage);

elements.prepareReleaseButton.addEventListener('click', prepareDistributionDefaults);
elements.recoveryBackup.addEventListener('click', () => recoverConfiguration('backup'));
elements.recoveryDefaults.addEventListener('click', () => recoverConfiguration('defaults'));
elements.reloadButton.addEventListener('click', () => loadConfiguration({ askBeforeDiscard: true }));
elements.saveButton.addEventListener('click', saveConfiguration);

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());
window.addEventListener('resize', renderEffectLivePreview);
window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (state.dirty && !state.busy) saveConfiguration();
  }
});

function initializeSettings() {
  if (state.apiAvailable) loadConfiguration();
  else disableUnavailableEditor();
}

initializeSettings();

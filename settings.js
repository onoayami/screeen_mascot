const REQUIRED_MASCOT_API_METHODS = Object.freeze([
  'loadConfig',
  'recoverConfig',
  'reportDirtyState',
  'resolveAsset',
  'getAssetMetadata',
  'discardImportedImage',
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
const IMAGE_SCALE_RULE = SETTINGS_RULES?.imageScale;
const IMAGE_OFFSET_RULE = SETTINGS_RULES?.imageOffset;
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
  recoveryHeading: document.getElementById('recovery-heading'),
  recoveryMessage: document.getElementById('recovery-message'),
  recoveryBackup: document.getElementById('recovery-backup'),
  recoveryDefaults: document.getElementById('recovery-defaults'),
  mascotSize: document.getElementById('mascot-size'),
  mascotSizeOutput: document.getElementById('mascot-size-output'),
  rememberPosition: document.getElementById('remember-position'),
  addAction: document.getElementById('add-action'),
  actionList: document.getElementById('action-list'),
  openSizeManager: document.getElementById('open-size-manager'),
  openDurationBulk: document.getElementById('open-duration-bulk'),
  emptyState: document.getElementById('empty-state'),
  actionEditor: document.getElementById('action-editor'),
  actionPreviewFrame: document.getElementById('action-preview-frame'),
  actionPreviewMarker: document.getElementById('action-preview-marker'),
  actionPreviewScale: document.getElementById('action-preview-scale'),
  actionActualSize: document.getElementById('action-actual-size'),
  moveUp: document.getElementById('move-up'),
  moveDown: document.getElementById('move-down'),
  deleteAction: document.getElementById('delete-action'),
  saveSelectedAction: document.getElementById('save-selected-action'),
  actionDropzone: document.getElementById('action-dropzone'),
  imageControlStack: document.getElementById('image-control-stack'),
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
  movementSpeedPreviewStage: document.getElementById('movement-speed-preview-stage'),
  movementSpeedPreviewImage: document.getElementById('movement-speed-preview-image'),
  movementSpeedPreviewNote: document.getElementById('movement-speed-preview-note'),
  movementSpeedPreviewStop: document.getElementById('movement-speed-preview-stop'),
  effectEnabled: document.getElementById('effect-enabled'),
  effectSettings: document.getElementById('effect-settings'),
  effectDropzone: document.getElementById('effect-dropzone'),
  effectPreview: document.getElementById('effect-preview'),
  effectPlaceholder: document.getElementById('effect-placeholder'),
  effectLivePreview: document.getElementById('effect-live-preview'),
  effectLiveMascot: document.getElementById('effect-live-mascot'),
  effectLiveMascotImage: document.getElementById('effect-live-mascot-image'),
  effectLiveImage: document.getElementById('effect-live-image'),
  effectPreviewScale: document.getElementById('effect-preview-scale'),
  effectActualSize: document.getElementById('effect-actual-size'),
  effectInterval: document.getElementById('effect-interval'),
  effectSize: document.getElementById('effect-size'),
  effectLifetime: document.getElementById('effect-lifetime'),
  effectOffsetX: document.getElementById('effect-offset-x'),
  effectOffsetY: document.getElementById('effect-offset-y'),
  effectWhileStill: document.getElementById('effect-while-still'),
  prepareReleaseButton: document.getElementById('prepare-release-button'),
  reloadButton: document.getElementById('reload-button'),
  headerSaveButton: document.getElementById('save-button-header'),
  saveButton: document.getElementById('save-button'),
  imageEditorDialog: document.getElementById('image-editor-dialog'),
  imageEditorClose: document.getElementById('image-editor-close'),
  imageEditorFrame: document.getElementById('image-editor-preview-frame'),
  imageEditorPreview: document.getElementById('image-editor-preview'),
  imageEditorStage: document.getElementById('image-editor-preview-stage'),
  imageEditorPreviewScale: document.getElementById('image-editor-preview-scale'),
  imageEditorActualSize: document.getElementById('image-editor-actual-size'),
  imageEditorMagnify: document.getElementById('image-editor-magnify'),
  actualSizeDialog: document.getElementById('actual-size-dialog'),
  actualSizeClose: document.getElementById('actual-size-close'),
  actualSizeScale: document.getElementById('actual-size-scale'),
  actualSizeViewport: document.getElementById('actual-size-viewport'),
  actualSizeScene: document.getElementById('actual-size-scene'),
  actualSizeMascot: document.getElementById('actual-size-mascot'),
  actualSizeImage: document.getElementById('actual-size-image'),
  actualSizeEffect: document.getElementById('actual-size-effect'),
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
  durationBulkDurationEnabled: document.getElementById('duration-bulk-duration-enabled'),
  durationBulkSpeedEnabled: document.getElementById('duration-bulk-speed-enabled'),
  durationBulkSpeed: document.getElementById('duration-bulk-speed'),
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
  persistedSnapshot: null,
  migrationPending: false,
  loadWarnings: [],
  migrationWarnings: [],
  dirty: false,
  applyRetry: false,
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
let lastRenderedEditorActionId = null;
const imagePanBindings = new WeakMap();
const actionMeasurements = new Map();
let measurementQueueRunning = false;
let measurementQueueRequested = false;
let activeImageEditor = null;
let refreshSizeManagerPreviews = null;
let actualSizeSource = null;
let movementPreviewFrame = null;
let movementPreviewRunning = false;
let movementPreviewLastTimestamp = null;
let movementPreviewPosition = 0;
let movementPreviewDirection = 1;
let movementPreviewActionId = null;
let durationBulkRevision = 0;

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
const MAX_ACTION_PREVIEW_SIZE = 216;

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
    scale: clamp(numberOr(transform.scale, 1), IMAGE_SCALE_RULE.minimum, IMAGE_SCALE_RULE.maximum),
    offsetX: clamp(
      numberOr(transform.offsetX, 0),
      IMAGE_OFFSET_RULE.minimum,
      IMAGE_OFFSET_RULE.maximum,
    ),
    offsetY: clamp(
      numberOr(transform.offsetY, 0),
      IMAGE_OFFSET_RULE.minimum,
      IMAGE_OFFSET_RULE.maximum,
    ),
  };
}

const CLIPPING_TOLERANCE = 0.005;
const FRAME_CLEARANCE_TARGET = 0.02;
const FRAME_FIT_LIMIT = 0.92;
const SAFE_FRAME_MARGIN = FRAME_CLEARANCE_TARGET + CLIPPING_TOLERANCE;

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
  return { clipped: edges.length > 0, edges, overflow, bounds };
}

function hasFrameIssue(clipping) {
  return Boolean(clipping?.clipped);
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
    return clamp(
      Math.round(corrected * 100) / 100,
      IMAGE_OFFSET_RULE.minimum,
      IMAGE_OFFSET_RULE.maximum,
    );
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

function stepMovementPreview(position, direction, speed, deltaSeconds, travelSpan) {
  if (!(travelSpan > 0) || !(speed > 0)) return { position, direction };
  const phase = direction >= 0 ? position : (2 * travelSpan) - position;
  const period = 2 * travelSpan;
  const nextPhase = ((phase + speed * Math.min(0.05, Math.max(0, deltaSeconds))) % period + period) % period;
  if (nextPhase < travelSpan) return { position: nextPhase, direction: 1 };
  return { position: period - nextPhase, direction: -1 };
}

function stopMovementSpeedPreview(message = '速さを変更するとプレビューします。') {
  if (movementPreviewFrame !== null) {
    window.cancelAnimationFrame(movementPreviewFrame);
    movementPreviewFrame = null;
  }
  movementPreviewRunning = false;
  movementPreviewLastTimestamp = null;
  movementPreviewActionId = null;
  elements.movementSpeedPreviewImage.hidden = true;
  elements.movementSpeedPreviewStop.disabled = true;
  elements.movementSpeedPreviewNote.textContent = message;
}

function movementPreviewImageTransform(action, direction) {
  const base = normalizeImageTransform(action.imageTransform);
  const directionFlip = action.flipMode === 'direction' && direction < 0;
  return { ...base, flipX: base.flipX !== directionFlip };
}

function animateMovementSpeedPreview(timestamp) {
  movementPreviewFrame = null;
  if (!movementPreviewRunning || document.hidden) {
    stopMovementSpeedPreview();
    return;
  }
  const action = selectedAction();
  if (!action || action._uiId !== movementPreviewActionId) {
    stopMovementSpeedPreview();
    return;
  }
  const stage = elements.movementSpeedPreviewStage.getBoundingClientRect();
  const travelSpan = stage.width - (8 * 2) - 76;
  if (!(travelSpan > 0)) {
    stopMovementSpeedPreview('プレビュー欄に移動できる幅がありません。');
    return;
  }
  const deltaSeconds = movementPreviewLastTimestamp === null
    ? 0
    : Math.min(0.05, Math.max(0, (timestamp - movementPreviewLastTimestamp) / 1000));
  movementPreviewLastTimestamp = timestamp;
  const speed = Number(elements.movementSpeed.value);
  const next = stepMovementPreview(
    movementPreviewPosition,
    movementPreviewDirection,
    speed,
    deltaSeconds,
    travelSpan,
  );
  movementPreviewPosition = next.position;
  if (movementPreviewDirection !== next.direction) {
    movementPreviewDirection = next.direction;
    applyImageTransform(
      elements.movementSpeedPreviewImage,
      movementPreviewImageTransform(action, movementPreviewDirection),
    );
  }
  elements.movementSpeedPreviewImage.style.left = `${8 + movementPreviewPosition}px`;
  movementPreviewFrame = window.requestAnimationFrame(animateMovementSpeedPreview);
}

function startMovementSpeedPreview(action) {
  const speed = Number(elements.movementSpeed.value);
  if (document.hidden) {
    stopMovementSpeedPreview();
    return;
  }
  if (!action || action.movement?.type === 'still') {
    stopMovementSpeedPreview('この動作はその場に留まるため、速度プレビューはありません。');
    return;
  }
  if (!action._assetUrl) {
    stopMovementSpeedPreview('画像を設定すると速度プレビューを表示できます。');
    return;
  }
  if (!Number.isFinite(speed) || speed <= 0 || speed > SETTINGS_RULES.movementSpeed.maximum) {
    stopMovementSpeedPreview('0より大きい速さに変更するとプレビューします。');
    return;
  }
  if (movementPreviewRunning && movementPreviewActionId === action._uiId) {
    elements.movementSpeedPreviewNote.textContent = `横移動をプレビュー中：${speed} px/秒`;
    return;
  }

  stopMovementSpeedPreview();
  const stage = elements.movementSpeedPreviewStage.getBoundingClientRect();
  if (!(stage.width - (8 * 2) - 76 > 0)) {
    elements.movementSpeedPreviewNote.textContent = 'プレビュー欄に移動できる幅がありません。';
    return;
  }
  movementPreviewRunning = true;
  movementPreviewActionId = action._uiId;
  movementPreviewPosition = 0;
  movementPreviewDirection = 1;
  movementPreviewLastTimestamp = null;
  elements.movementSpeedPreviewImage.src = action._assetUrl;
  elements.movementSpeedPreviewImage.hidden = false;
  elements.movementSpeedPreviewImage.style.left = '8px';
  applyImageTransform(
    elements.movementSpeedPreviewImage,
    movementPreviewImageTransform(action, movementPreviewDirection),
  );
  elements.movementSpeedPreviewStop.disabled = false;
  elements.movementSpeedPreviewNote.textContent = `横移動をプレビュー中：${speed} px/秒`;
  movementPreviewFrame = window.requestAnimationFrame(animateMovementSpeedPreview);
}

function showDialog(dialog) {
  stopMovementSpeedPreview();
  dialog.showModal();
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
      IMAGE_OFFSET_RULE.minimum,
      IMAGE_OFFSET_RULE.maximum,
    );
    currentTransform.offsetY = clamp(
      Math.round((activeDrag.offsetY + (event.clientY - activeDrag.startY) / activeDrag.height * 100) * 100) / 100,
      IMAGE_OFFSET_RULE.minimum,
      IMAGE_OFFSET_RULE.maximum,
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
  stopMovementSpeedPreview();
  state.apiAvailable = false;
  state.busy = false;
  state.dirty = false;
  state.migrationPending = false;
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
  if (busy) stopMovementSpeedPreview();
  updateSaveButtons();
  elements.reloadButton.disabled = busy;
  elements.prepareReleaseButton.disabled = busy;
  elements.addAction.disabled = busy || state.actions.length >= MAX_ACTIONS;
  elements.actionFitInFrame.disabled = busy;
  elements.openSizeManager.disabled = busy;
  elements.openDurationBulk.disabled = busy || state.actions.length === 0;
  elements.recoveryBackup.disabled = busy || Boolean(elements.recoveryBackup.dataset.unavailable);
  elements.recoveryDefaults.disabled = busy;
}

function updateSaveButtons() {
  for (const button of [elements.headerSaveButton, elements.saveButton]) {
    if (button) button.disabled = !state.apiAvailable || state.busy || !state.dirty;
  }
  if (!elements.saveSelectedAction) return;
  const action = selectedAction();
  elements.saveSelectedAction.disabled = state.busy
    || !action
    || (!state.applyRetry && !isSelectedActionPending(action));
  elements.saveSelectedAction.setAttribute(
    'aria-label',
    action ? `「${action.name || '名前のない動作'}」を保存` : '選択中の動作を保存',
  );
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
  updateSaveButtons();
}

function markSaved() {
  state.dirty = false;
  state.applyRetry = false;
  window.mascotAPI.reportDirtyState(false);
  elements.saveState.textContent = '保存済み';
  elements.saveState.classList.remove('is-dirty');
  elements.saveState.classList.add('is-saved');
  elements.feedback.textContent = '設定はマスコットへ反映されています。';
  elements.feedback.classList.remove('is-error');
  updateSaveButtons();
}

function markLoaded() {
  state.dirty = false;
  state.applyRetry = false;
  window.mascotAPI.reportDirtyState(false);
  elements.saveState.textContent = '読み込み済み';
  elements.saveState.classList.remove('is-dirty', 'is-saved');
  elements.feedback.textContent = '設定ファイルを読み込みました。マスコットへの反映状態は未確認です。';
  elements.feedback.classList.remove('is-error');
  updateSaveButtons();
}

function markMigrationsPersisted() {
  state.migrationPending = false;
  if (state.migrationWarnings.length === 0) return;
  const migrationWarnings = new Set(state.migrationWarnings);
  state.loadWarnings = state.loadWarnings.filter((warning) => !migrationWarnings.has(warning));
  state.migrationWarnings = [];
  elements.recoveryMessage.textContent = state.loadWarnings.join('／');
  elements.recoveryPanel.hidden = state.loadWarnings.length === 0;
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

  const flipMode = ALLOWED_FLIPS.has(action.flipMode)
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
    durationMs: Array.isArray(action.durationMs) ? [...action.durationMs] : [...DEFAULT_DURATION_MS],
    ...(effect ? { effect } : {}),
  };
}

function canonicalValue(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return { __number: String(value) };
  }
  if (value === undefined) return { __undefined: true };
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => !key.startsWith('_'))
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function comparableScalar(value) {
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return value;
}

function comparableAction(action = {}) {
  const transform = action.imageTransform || {};
  const movement = action.movement || {};
  const effect = action.effect;
  return canonicalValue({
    name: String(action.name ?? '').trim(),
    file: action.file ?? '',
    weight: comparableScalar(action.weight ?? 1),
    durationMs: Array.isArray(action.durationMs)
      ? action.durationMs.map(comparableScalar)
      : [...DEFAULT_DURATION_MS],
    flipMode: action.flipMode ?? 'direction',
    imageTransform: {
      flipX: transform.flipX ?? false,
      scale: comparableScalar(transform.scale ?? 1),
      offsetX: comparableScalar(transform.offsetX ?? 0),
      offsetY: comparableScalar(transform.offsetY ?? 0),
    },
    movement: {
      type: movement.type ?? 'still',
      speed: comparableScalar(movement.speed ?? 0),
    },
    effect: effect
      ? {
          file: effect.file ?? '',
          intervalMs: comparableScalar(effect.intervalMs ?? 450),
          size: comparableScalar(effect.size ?? 32),
          lifetimeMs: comparableScalar(effect.lifetimeMs ?? 1800),
          offsetX: comparableScalar(effect.offsetX ?? 0),
          offsetY: comparableScalar(effect.offsetY ?? 12),
          coordinateVersion: effect.coordinateVersion ?? 2,
          emitWhileStill: effect.emitWhileStill ?? false,
        }
      : null,
  });
}

function comparableConfig(config = {}) {
  const mascot = config.mascot || {};
  return JSON.stringify(canonicalValue({
    name: String(config.name ?? 'マスコット').trim() || 'マスコット',
    mascot: {
      size: comparableScalar(mascot.size ?? 180),
      startPosition: mascot.startPosition ?? 'bottom-right',
      margin: comparableScalar(mascot.margin ?? 40),
      rememberPosition: mascot.rememberPosition !== false,
    },
    actions: (config.actions || []).map(comparableAction),
  }));
}

function workingConfigForComparison() {
  return {
    ...state.config,
    actions: state.actions,
  };
}

function setPersistedSnapshot(config, actionIds) {
  if (!config || !Array.isArray(config.actions)) {
    state.persistedSnapshot = null;
    return;
  }
  state.persistedSnapshot = {
    config: structuredClone(config),
    actionIds: config.actions.map((_, index) => actionIds[index] || newId()),
  };
}

function hasPendingChanges() {
  if (!state.persistedSnapshot || !state.config) return Boolean(state.config || state.actions.length);
  return state.migrationPending || comparableConfig(workingConfigForComparison())
    !== comparableConfig(state.persistedSnapshot.config);
}

function persistedActionIndex(actionId) {
  return state.persistedSnapshot?.actionIds.indexOf(actionId) ?? -1;
}

function isSelectedActionPending(action = selectedAction()) {
  if (!action || !state.persistedSnapshot) return Boolean(action);
  const index = persistedActionIndex(action._uiId);
  if (index < 0) return true;
  return JSON.stringify(comparableAction(action))
    !== JSON.stringify(comparableAction(state.persistedSnapshot.config.actions[index]));
}

function refreshPendingStatus(message = '未保存の変更', feedback = null) {
  const pending = hasPendingChanges();
  state.dirty = state.applyRetry || pending;
  window.mascotAPI.reportDirtyState(state.dirty);
  elements.saveState.textContent = state.applyRetry
    ? (pending ? '保存済み・未保存の変更あり' : '保存済み・反映を再試行')
    : state.dirty
      ? message
      : '保存済み';
  elements.saveState.classList.toggle('is-dirty', state.dirty);
  elements.saveState.classList.toggle('is-saved', !state.dirty);
  elements.feedback.textContent = feedback
    || (state.applyRetry
      ? '保存した設定をマスコットへ反映できませんでした。もう一度保存すると再試行できます。'
      : state.dirty
        ? '変更はまだ保存されていません。'
        : '設定はマスコットへ反映されています。');
  elements.feedback.classList.toggle('is-error', state.applyRetry);
  updateSaveButtons();
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
    elements.recoveryHeading.textContent = config ? '設定の確認' : '設定を安全に復旧できます';
    elements.recoveryMessage.textContent = !config
      ? (recovery.message || '設定ファイルを読み込めません。下のボタンから安全に復旧できます。')
      : warnings.join('／');
    elements.recoveryBackup.dataset.unavailable = recovery.canRestoreBackup ? '' : 'true';
    elements.recoveryBackup.disabled = !recovery.canRestoreBackup;
    if (!config) {
      state.config = null;
      state.actions = [];
      state.selectedId = null;
      state.persistedSnapshot = null;
      state.migrationPending = false;
      state.loadWarnings = [];
      state.migrationWarnings = [];
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
    state.migrationPending = Array.isArray(editable?.pendingMigrations)
      && editable.pendingMigrations.includes('legacy-movement-speed');
    state.loadWarnings = warnings;
    state.migrationWarnings = state.migrationPending
      ? warnings.filter((warning) => warning.includes('旧速さ設定を上限300'))
      : [];
    setPersistedSnapshot(state.config, actions.map((action) => action._uiId));
    state.revision = 0;
    renderAll();
    markLoaded();
    if (warnings.length > 0) {
      elements.feedback.textContent = (editable?.missingAssets || []).length > 0
        ? '見つからない画像を新しい画像へ差し替えて保存してください。'
        : warnings.join('／');
      elements.feedback.classList.add('is-error');
    }
    if (state.migrationPending) {
      refreshPendingStatus(
        '旧速さ設定の保存が必要',
        '設定ファイルには旧速さが残っています。全体保存、または選択中の動作を保存すると、旧速さ設定が300で更新されます。',
      );
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
    const restoredLegacySpeed = Array.isArray(result.warnings)
      && result.warnings.some((warning) => warning.includes('旧速さ設定を上限300'));
    showToast(restoredLegacySpeed
      ? 'バックアップの旧速さ設定を300にして復元しました。'
      : strategy === 'backup'
        ? '直前の正常な設定へ戻しました。'
        : '初期設定へ戻しました。');
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
  elements.mascotSize.value = mascot.size;
  elements.mascotSizeOutput.textContent = `${mascot.size} px`;
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
    const warningLabel = '⚠画像が枠からはみ出しています';
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
      const previousId = state.selectedId;
      state.selectedId = action._uiId;
      updateActionListSelection(previousId, state.selectedId);
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
    actionCardViews.set(action._uiId, { card, button, name, weightInput, warning });
  }
}

function updateActionListSelection(previousId, nextId) {
  for (const [id, selected] of [[previousId, false], [nextId, true]]) {
    const view = actionCardViews.get(id);
    if (!view) continue;
    view.card.classList.toggle('is-selected', selected);
    view.button.setAttribute('aria-current', selected ? 'true' : 'false');
  }
}

function updateActionCardClipping(action) {
  const view = actionCardViews.get(action?._uiId);
  if (!view) return;
  const frameIssue = hasFrameIssue(getActionClipping(action, action.imageTransform));
  const displayName = action.name || '名前のない動作';
  const warningLabel = '⚠画像が枠からはみ出しています';
  view.button.title = frameIssue ? warningLabel : displayName;
  if (frameIssue && !view.warning) {
    view.warning = document.createElement('span');
    view.warning.className = 'action-clipping-warning';
    view.warning.textContent = ' ⚠';
    view.warning.title = warningLabel;
    view.warning.setAttribute('aria-label', warningLabel);
  }
  if (view.warning) {
    if (frameIssue) view.name.appendChild(view.warning);
    else view.warning.remove();
  }
}

function refreshClippingIndicators() {
  for (const action of state.actions) updateActionCardClipping(action);
  const action = selectedAction();
  const clipping = updateClippingStatus(
    elements.actionClippingStatus,
    action,
    action?.imageTransform,
  );
  elements.actionFitInFrame.hidden = !hasFrameIssue(clipping);
  if (activeImageEditor) {
    const editorAction = state.actions.find(
      (candidate) => candidate._uiId === activeImageEditor.actionId,
    );
    updateClippingStatus(
      elements.imageEditorClippingStatus,
      editorAction,
      activeImageEditor.transform,
    );
  }
}

function previewScreenGeometry(size = state.config?.mascot?.size) {
  const screen = window.screen || {};
  const width = Math.max(1, Math.round(Number(screen.availWidth) || Number(window.innerWidth) || 1024));
  const height = Math.max(1, Math.round(Number(screen.availHeight) || Number(window.innerHeight) || 768));
  const maximum = Math.min(Math.max(1, width - SAFE_EDGE_INSET * 2), Math.max(1, height - SAFE_EDGE_INSET * 2));
  const configured = Number.isFinite(Number(size)) && Number(size) > 0 ? Number(size) : 180;
  return { width, height, maximum, configured, effective: Math.min(configured, maximum) };
}

function previewContentBox(element) {
  const style = window.getComputedStyle?.(element);
  return {
    width: Math.max(0, (element.clientWidth || 0)
      - (parseFloat(style?.paddingLeft) || 0) - (parseFloat(style?.paddingRight) || 0)),
    height: Math.max(0, (element.clientHeight || 0)
      - (parseFloat(style?.paddingTop) || 0) - (parseFloat(style?.paddingBottom) || 0)),
  };
}

function previewFitRatio(width, height, availableWidth, availableHeight) {
  return Math.max(0, Math.min(1, availableWidth / width, availableHeight / height));
}

function previewScaleLabel(geometry, ratio) {
  const percent = Number((ratio * 100).toFixed(1));
  const scale = ratio > 1
    ? `編集用拡大 ${percent}%（実寸ではありません）`
    : ratio === 1 ? '実寸 100%' : `縮小表示 ${percent}%`;
  const size = geometry.configured === geometry.effective
    ? `枠 ${geometry.effective}px`
    : `設定 ${geometry.configured}px → 画面上限 ${geometry.effective}px`;
  return `${scale}・${size}`;
}

function fitMascotPreview(frame, label, container, size, { square = false, magnify = false } = {}) {
  const geometry = previewScreenGeometry(size);
  const box = previewContentBox(container);
  const height = square ? box.width : box.height;
  if (!box.width || !height) {
    label.textContent = 'プレビューを配置中…';
    return;
  }
  const ratio = magnify
    ? Math.min(box.width, height) / geometry.effective
    : previewFitRatio(geometry.effective, geometry.effective, box.width, height);
  frame.style.width = `${geometry.effective * ratio}px`;
  frame.style.height = `${geometry.effective * ratio}px`;
  label.textContent = previewScaleLabel(geometry, ratio);
}

function fitActionMascotPreview() {
  const geometry = previewScreenGeometry();
  const box = previewContentBox(elements.imageControlStack);
  const availableWidth = Math.min(MAX_ACTION_PREVIEW_SIZE, Math.max(0, box.width - 44));
  const availableHeight = MAX_ACTION_PREVIEW_SIZE;
  if (!availableWidth || !box.width) {
    elements.actionPreviewScale.textContent = 'プレビューを配置中…';
    return;
  }
  const ratio = previewFitRatio(geometry.effective, geometry.effective, availableWidth, availableHeight);
  const size = geometry.effective * ratio;
  elements.actionPreviewFrame.style.width = `${size}px`;
  elements.actionPreviewFrame.style.height = `${size}px`;
  elements.actionPreviewScale.textContent = previewScaleLabel(geometry, ratio);
}

function setPreviewSource(image, url) {
  // Avoid restarting GIFs when only layout or transforms change.
  if (image.dataset.previewSource === (url || '')) return;
  image.dataset.previewSource = url || '';
  if (url) image.src = url;
  else image.removeAttribute('src');
}

function effectSceneGeometry(size, effect, image) {
  const geometry = previewScreenGeometry(size);
  const mascot = geometry.effective;
  const effectWidth = effect?._assetUrl ? Number(effect.size) || 32 : 0;
  const effectHeight = effectWidth * ((image.naturalHeight || 1) / (image.naturalWidth || 1));
  const centerX = mascot / 2 + (Number(effect?.offsetX) || 0);
  const centerY = mascot - (Number(effect?.offsetY) || 0);
  const left = effectWidth ? Math.min(0, centerX - effectWidth / 2) : 0;
  const top = effectWidth ? Math.min(0, centerY - effectHeight / 2) : 0;
  const right = effectWidth ? Math.max(mascot, centerX + effectWidth / 2) : mascot;
  const bottom = effectWidth ? Math.max(mascot, centerY + effectHeight / 2) : mascot;
  return { ...geometry, left, top, width: right - left, height: bottom - top, effectWidth, centerX, centerY };
}

function renderPreviewScene(source, views, actual = false) {
  const { action, transform = action.imageTransform, size, effect } = source;
  setPreviewSource(views.image, action._assetUrl);
  applyImageTransform(views.image, transform);
  setPreviewSource(views.effect, effect?._assetUrl);
  views.effect.hidden = !effect?._assetUrl;
  const geometry = effectSceneGeometry(size, effect, views.effect);
  const box = previewContentBox(views.stage);
  const ratio = actual ? 1 : previewFitRatio(geometry.width, geometry.height, box.width, box.height);
  if (!actual && !ratio) {
    views.label.textContent = 'プレビューを配置中…';
    return;
  }
  if (actual) {
    views.stage.style.width = `${geometry.width}px`;
    views.stage.style.height = `${geometry.height}px`;
  }
  const left = (actual ? 0 : (box.width - geometry.width * ratio) / 2) - geometry.left * ratio;
  const top = (actual ? 0 : (box.height - geometry.height * ratio) / 2) - geometry.top * ratio;
  Object.assign(views.mascot.style, {
    width: `${geometry.effective * ratio}px`, height: `${geometry.effective * ratio}px`,
    left: `${left}px`, top: `${top}px`,
  });
  Object.assign(views.effect.style, {
    width: `${geometry.effectWidth * ratio}px`,
    left: `${left + geometry.centerX * ratio}px`, top: `${top + geometry.centerY * ratio}px`,
  });
  views.label.textContent = previewScaleLabel(geometry, ratio);
}

function renderEffectLivePreview() {
  const action = selectedAction();
  if (!action?.effect || elements.effectSettings.hidden) {
    elements.effectLiveImage.hidden = true;
    return;
  }
  renderPreviewScene({ action, effect: action.effect }, {
    stage: elements.effectLivePreview, mascot: elements.effectLiveMascot,
    image: elements.effectLiveMascotImage, effect: elements.effectLiveImage, label: elements.effectPreviewScale,
  });
}

function renderActualSizePreview() {
  if (!elements.actualSizeDialog.open || !actualSizeSource) return;
  const source = actualSizeSource();
  if (!source?.action) return;
  renderPreviewScene(source, {
    stage: elements.actualSizeScene, mascot: elements.actualSizeMascot,
    image: elements.actualSizeImage, effect: elements.actualSizeEffect, label: elements.actualSizeScale,
  }, true);
}

function openActualSizePreview(source) {
  actualSizeSource = source;
  showDialog(elements.actualSizeDialog);
  renderActualSizePreview();
  elements.actualSizeViewport.scrollLeft = 0;
  elements.actualSizeViewport.scrollTop = 0;
  requestAnimationFrame(renderActualSizePreview);
}

function closeActualSizePreview() {
  actualSizeSource = null;
  if (elements.actualSizeDialog.open) elements.actualSizeDialog.close();
}

function refreshPreviewGeometry() {
  if (selectedAction()?._assetUrl) {
    fitActionMascotPreview();
  }
  if (elements.imageEditorDialog.open) activeImageEditor?.refreshGeometry();
  if (elements.sizeManagerDialog.open) refreshSizeManagerPreviews?.();
  renderEffectLivePreview();
  renderActualSizePreview();
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

function updateClippingStatus(element, action, transform) {
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
  element.textContent = clipping.clipped
    ? '⚠画像が枠からはみ出しています'
    : '見切れなし';
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
  const actionId = action?._uiId ?? null;
  if (
    actionId !== lastRenderedEditorActionId
    || action?.movement?.type === 'still'
    || !action?._assetUrl
  ) {
    stopMovementSpeedPreview(
      action?.movement?.type === 'still'
        ? 'この動作はその場に留まるため、速度プレビューはありません。'
        : action && !action._assetUrl
          ? '画像を設定すると速度プレビューを表示できます。'
          : '速さを変更するとプレビューします。',
    );
  }
  lastRenderedEditorActionId = actionId;
  const hasAction = Boolean(action);
  elements.emptyState.hidden = hasAction;
  elements.actionEditor.hidden = !hasAction;
  elements.actionDropzone.classList.toggle('has-image', Boolean(action?._assetUrl));
  updateSaveButtons();
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
  elements.actionPreviewMarker.hidden = !action._assetUrl;
  applyImageTransform(elements.actionPreview, action.imageTransform);
  elements.actionActualSize.disabled = !action._assetUrl;
  elements.actionPreviewScale.hidden = !action._assetUrl;
  refreshPreviewGeometry();
  requestAnimationFrame(refreshPreviewGeometry);
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
  view.name.textContent = displayName;
  updateActionCardClipping(action);
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
  const firstMovingAction = state.actions.find((action) => action.movement?.type !== 'still');
  elements.durationBulkDurationEnabled.checked = true;
  elements.durationBulkSpeedEnabled.checked = false;
  elements.durationBulkMin.disabled = false;
  elements.durationBulkMax.disabled = false;
  elements.durationBulkSpeed.disabled = true;
  elements.durationBulkMin.value = numberOr(duration?.[0], DEFAULT_DURATION_MS[0]) / 1000;
  elements.durationBulkMax.value = numberOr(duration?.[1], DEFAULT_DURATION_MS[1]) / 1000;
  elements.durationBulkSpeed.value = numberOr(firstMovingAction?.movement?.speed, 55);
  durationBulkRevision = state.revision;
  updateDurationBulkCount();
  elements.durationBulkError.textContent = '';
  elements.durationBulkError.hidden = true;
  showDialog(elements.durationBulkDialog);
}

function updateDurationBulkCount() {
  const movingCount = state.actions.filter((action) => action.movement?.type !== 'still').length;
  const targets = [];
  targets.push(elements.durationBulkDurationEnabled.checked
    ? `表示時間：${state.actions.length}件`
    : '表示時間：変更しない');
  targets.push(elements.durationBulkSpeedEnabled.checked
    ? `速さ：移動する動作${movingCount}件（その場に留まる動作は変更しません）`
    : '速さ：変更しない');
  elements.durationBulkCount.textContent = targets.join('。');
}

function readBulkDuration() {
  if (!elements.durationBulkDurationEnabled.checked) return null;
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

function readBulkSpeed() {
  if (!elements.durationBulkSpeedEnabled.checked) return null;
  const speed = readNumberInput(elements.durationBulkSpeed.value);
  if (!Number.isFinite(speed) || !Number.isInteger(speed)) {
    elements.durationBulkError.textContent = '速さを整数で入力してください。';
    elements.durationBulkError.hidden = false;
    return null;
  }
  if (speed < SETTINGS_RULES.movementSpeed.minimum || speed > SETTINGS_RULES.movementSpeed.maximum) {
    elements.durationBulkError.textContent = `速さは${SETTINGS_RULES.movementSpeed.minimum}〜${SETTINGS_RULES.movementSpeed.maximum}にしてください。`;
    elements.durationBulkError.hidden = false;
    return null;
  }
  return speed;
}

async function applyDurationBulk() {
  if (state.busy) return false;
  elements.durationBulkError.textContent = '';
  elements.durationBulkError.hidden = true;
  if (durationBulkRevision !== state.revision) {
    elements.durationBulkError.textContent = '設定が変更されました。いったん閉じてから、もう一度開いてください。';
    elements.durationBulkError.hidden = false;
    return false;
  }
  const applyDuration = elements.durationBulkDurationEnabled.checked;
  const applySpeed = elements.durationBulkSpeedEnabled.checked;
  if (!applyDuration && !applySpeed) {
    elements.durationBulkError.textContent = '表示時間または速さを選択してください。';
    elements.durationBulkError.hidden = false;
    return false;
  }
  const duration = readBulkDuration();
  if (applyDuration && !duration) return false;
  const speed = readBulkSpeed();
  if (applySpeed && speed === null) return false;
  const movingActions = state.actions.filter((action) => action.movement?.type !== 'still');
  if (applySpeed && movingActions.length === 0) {
    elements.durationBulkError.textContent = '速さを変更できる動作がありません。「その場に留まる」以外の動作を追加してください。';
    elements.durationBulkError.hidden = false;
    return false;
  }

  if (applyDuration) {
    for (const action of state.actions) action.durationMs = [...duration];
  }
  if (applySpeed) {
    for (const action of movingActions) action.movement.speed = speed;
  }
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
  stopMovementSpeedPreview();
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

function stateReferencesAsset(relativePath) {
  return state.actions.some((action) => (
    action.file === relativePath || action.effect?.file === relativePath
  ));
}

async function discardUnreferencedImportedImage(relativePath, category) {
  if (!relativePath || stateReferencesAsset(relativePath)) return false;
  try {
    return await window.mascotAPI.discardImportedImage(relativePath, category);
  } catch (error) {
    console.warn('未使用の取り込み画像を整理できませんでした。', error);
    return false;
  }
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
  const toleranceSquared = tolerance * tolerance;
  const featherEnd = tolerance + feather;
  const featherEndSquared = featherEnd ** 2;
  const distanceAtMost = (distanceSquared, radius, radiusSquared) => {
    if (radius < 0) return false;
    const boundaryMargin = Number.EPSILON
      * Math.max(1, Math.abs(distanceSquared), Math.abs(radiusSquared))
      * 8;
    if (Math.abs(distanceSquared - radiusSquared) <= boundaryMargin) {
      return Math.sqrt(distanceSquared) <= radius;
    }
    return distanceSquared < radiusSquared;
  };
  const distanceBelow = (distanceSquared, radius, radiusSquared) => {
    if (radius < 0) return false;
    const boundaryMargin = Number.EPSILON
      * Math.max(1, Math.abs(distanceSquared), Math.abs(radiusSquared))
      * 8;
    if (Math.abs(distanceSquared - radiusSquared) <= boundaryMargin) {
      return Math.sqrt(distanceSquared) < radius;
    }
    return distanceSquared < radiusSquared;
  };

  for (let index = 0; index < output.data.length; index += 4) {
    const deltaR = output.data[index] - background.r;
    const deltaG = output.data[index + 1] - background.g;
    const deltaB = output.data[index + 2] - background.b;
    const distanceSquared = deltaR ** 2 + deltaG ** 2 + deltaB ** 2;

    if (distanceAtMost(distanceSquared, tolerance, toleranceSquared)) {
      output.data[index + 3] = 0;
    } else if (feather > 0 && distanceBelow(distanceSquared, featherEnd, featherEndSquared)) {
      const distance = Math.sqrt(distanceSquared);
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
    showDialog(elements.jpegDialog);
  });
}

async function prepareImportedImage(result, category, convert = openJpegConverter) {
  if (!isJpegImport(result)) return result;
  try {
    const prepared = await convert(result, category);
    if (!prepared || prepared.relativePath !== result.relativePath) {
      await discardUnreferencedImportedImage(result.relativePath, category);
    }
    return prepared;
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
    const targetId = state.selectedId;
    let sourcePath;
    try {
      sourcePath = await window.mascotAPI.getPathForFile(file);
    } catch (error) {
      console.error(error);
      showError(`画像の場所を取得できませんでした：${readableError(error)}`);
      return;
    }
    if (!sourcePath) {
      showError('画像の場所を取得できませんでした。クリックして画像を選んでください。');
      return;
    }

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
const SIZE_MEASUREMENT_LOAD_TIMEOUT_MS = 6000;
const SIZE_MEASUREMENT_CACHE_LIMIT = 100;
const sizeMeasurementCache = new Map();

function loadSizeMeasurementImage(source, timeoutMs = SIZE_MEASUREMENT_LOAD_TIMEOUT_MS) {
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
      const actionsById = new Map(actionsWithImages.map((action) => [action._uiId, action]));
      for (const [id, entry] of actionMeasurements) {
        const action = actionsById.get(id);
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
    refreshClippingIndicators();
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
  const { width: availableWidth, height: availableHeight, maximum: maximumDisplaySize } = previewScreenGeometry(initialMascotSize);
  const shortSide = Math.min(availableWidth, availableHeight);
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
  const cardPreviews = new Map();
  refreshSizeManagerPreviews = () => {
    if (!isSizeManagerGenerationCurrent(generation)) return;
    for (const { preview, label, card } of cardPreviews.values()) {
      fitMascotPreview(preview, label, card, workingMascotSize, { square: true });
    }
    renderActualSizePreview();
  };
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
    refreshSizeManagerPreviews();
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
    cardPreviews.clear();

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
      const previewLabel = document.createElement('p');
      const actualButton = document.createElement('button');
      const previewToolbar = document.createElement('div');
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
        image.addEventListener('load', () => {
          if (isSizeManagerGenerationCurrent(generation)) refreshSizeManagerPreviews?.();
        });
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
      slider.min = String(IMAGE_SCALE_RULE.minimum);
      slider.max = String(IMAGE_SCALE_RULE.maximum);
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
        clippingWarning.textContent = '⚠画像が枠からはみ出しています';
      };
      metrics.className = 'size-card-metrics';
      metrics.textContent = visualMetric(action);
      cardMetrics.set(action._uiId, metrics);
      slider.addEventListener('input', () => {
        transform.scale = clamp(
          numberOr(slider.value, 1),
          IMAGE_SCALE_RULE.minimum,
          IMAGE_SCALE_RULE.maximum,
        );
        controlOutput.textContent = `${Math.round(transform.scale * 100)}%`;
        const image = preview.querySelector('img');
        if (image) applyImageTransform(image, transform);
        metrics.textContent = visualMetric(action);
        updateClippingWarning();
        updateFitClippedButton();
      });
      controls.append(controlLabel, slider, metrics);
      card.append(header, preview, controls, clippingWarning);
      previewLabel.className = 'preview-scale';
      previewLabel.title = '表示枠の上限は、設定画面を開いている画面を基準にしています。';
      actualButton.className = 'secondary-button compact-button';
      actualButton.type = 'button';
      actualButton.textContent = '実寸で見る';
      actualButton.disabled = !action._assetUrl;
      actualButton.addEventListener('click', () => openActualSizePreview(() => ({
        action, transform: working.get(action._uiId), size: workingMascotSize,
      })));
      previewToolbar.className = 'size-card-preview-toolbar';
      previewToolbar.append(previewLabel, actualButton);
      card.append(previewToolbar);
      cardPreviews.set(action._uiId, { preview, label: previewLabel, card });
      elements.sizeManagerGrid.appendChild(card);
      updateClippingWarning();
    }
    updateFitClippedButton();
    refreshSizeManagerPreviews();
  };

  const closeDialog = () => {
    closeActualSizePreview();
    refreshSizeManagerPreviews = null;
    cardPreviews.clear();
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
  showDialog(elements.sizeManagerDialog);
  refreshSizeManagerPreviews();
  requestAnimationFrame(() => {
    if (isSizeManagerGenerationCurrent(generation)) refreshSizeManagerPreviews?.();
  });

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
      const scale = clamp(
        target / Math.max(0.001, baseSize),
        IMAGE_SCALE_RULE.minimum,
        IMAGE_SCALE_RULE.maximum,
      );
      current.scale = scale;
      const adjustedMeasurement = measurementForTransform(measurement, current);
      current.offsetX = clamp(
        -100 * scale * (adjustedMeasurement.centerX - 0.5),
        IMAGE_OFFSET_RULE.minimum,
        IMAGE_OFFSET_RULE.maximum,
      );
      current.offsetY = clamp(
        -100 * scale * (adjustedMeasurement.centerY - 0.5),
        IMAGE_OFFSET_RULE.minimum,
        IMAGE_OFFSET_RULE.maximum,
      );
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
  elements.imageEditorMagnify.checked = false;
  const refreshGeometry = () => fitMascotPreview(
    elements.imageEditorFrame, elements.imageEditorPreviewScale, elements.imageEditorStage,
    state.config?.mascot?.size, { magnify: elements.imageEditorMagnify.checked },
  );
  activeImageEditor.refreshGeometry = refreshGeometry;

  const updatePreview = () => {
    working.flipX = elements.imageEditorFlipX.checked;
    working.scale = clamp(
      numberOr(elements.imageScale.value, 1),
      IMAGE_SCALE_RULE.minimum,
      IMAGE_SCALE_RULE.maximum,
    );
    working.offsetX = clamp(
      numberOr(elements.imageOffsetX.value, 0),
      IMAGE_OFFSET_RULE.minimum,
      IMAGE_OFFSET_RULE.maximum,
    );
    working.offsetY = clamp(
      numberOr(elements.imageOffsetY.value, 0),
      IMAGE_OFFSET_RULE.minimum,
      IMAGE_OFFSET_RULE.maximum,
    );
    elements.imageScaleOutput.textContent = `${Math.round(working.scale * 100)}%`;
    elements.imageOffsetXOutput.textContent = formatImageOffset(working.offsetX);
    elements.imageOffsetYOutput.textContent = formatImageOffset(working.offsetY);
    applyImageTransform(elements.imageEditorPreview, working);
    refreshGeometry();
    renderActualSizePreview();
    updateClippingStatus(
      elements.imageEditorClippingStatus,
      action,
      working,
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
    closeActualSizePreview();
    if (activeImageEditor?.actionId === action._uiId) activeImageEditor = null;
    if (elements.imageEditorDialog.open) elements.imageEditorDialog.close();
  };

  elements.imageScale.oninput = updatePreview;
  elements.imageEditorMagnify.onchange = refreshGeometry;
  elements.imageEditorActualSize.onclick = () => openActualSizePreview(() => ({ action, transform: working }));
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
  showDialog(elements.imageEditorDialog);
  refreshGeometry();
  requestAnimationFrame(() => {
    if (activeImageEditor?.transform === working) refreshGeometry();
  });
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
  if (state.actions.length > MAX_ACTIONS) {
    throw new Error(`動作は${MAX_ACTIONS}件以下にしてください。`);
  }

  state.actions.forEach((action, index) => validateEditableAction(action, index));
}

function validateEditableAction(action, index) {
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
}

function serializeAction(action, index) {
  validateEditableAction(action, index);
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
    flipMode: ALLOWED_FLIPS.has(action.flipMode) ? action.flipMode : 'direction',
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
}

function serializeConfig() {
  if (!state.config) throw new Error('設定を読み込めていません。');
  if (state.actions.length === 0) throw new Error('動作を1件以上追加してください。');
  if (state.actions.length > MAX_ACTIONS) throw new Error(`動作は${MAX_ACTIONS}件までにしてください。`);
  validateEditableStateForSave();

  const actions = state.actions.map((action, index) => serializeAction(action, index));

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

function editableActionFromConfig(action, previous, uiId) {
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
    _uiId: uiId,
    _assetUrl: previous?.file === action.file ? previous._assetUrl : null,
    weight: positiveWeight(action.weight, 1),
    flipMode: ALLOWED_FLIPS.has(action.flipMode) ? action.flipMode : 'direction',
    movement: { type: 'still', speed: 0, ...(action.movement || {}) },
    durationMs: Array.isArray(action.durationMs) ? [...action.durationMs] : [...DEFAULT_DURATION_MS],
    ...(effect ? { effect } : {}),
  };
}

function applyNormalizedConfigToState(config, actionIds) {
  const previousActions = state.actions;
  const previousById = new Map(previousActions.map((action) => [action._uiId, action]));

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
    const uiId = actionIds[index] || newId();
    return editableActionFromConfig(action, previousById.get(uiId), uiId);
  });
  if (!state.actions.some((action) => action._uiId === state.selectedId)) {
    state.selectedId = state.actions[0]?._uiId || null;
  }
  renderAll();
}

function markApplyRetry(message) {
  state.applyRetry = true;
  refreshPendingStatus('未保存の変更', message);
}

function markNewerChangesPending() {
  refreshPendingStatus(
    '未保存の変更',
    '保存中に新しい変更がありました。もう一度「保存して反映」を押してください。',
  );
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
    const requestActionIds = state.actions.map((action) => action._uiId);
    const selectedIndex = Math.max(
      0,
      state.actions.findIndex((action) => action._uiId === state.selectedId),
    );
    const revisionAtStart = state.revision;
    elements.feedback.textContent = '保存し、マスコットへの反映を確認しています…';
    elements.feedback.classList.remove('is-error');
    const result = await window.mascotAPI.saveConfig(payload, selectedIndex);
    if (!result?.ok) throw new Error('保存に失敗しました。');
    const savedConfig = result.config || payload;
    setPersistedSnapshot(savedConfig, requestActionIds);
    markMigrationsPersisted();
    state.applyRetry = !result.applied;

    if (state.revision !== revisionAtStart) {
      markNewerChangesPending();
      if (!result.applied) {
        elements.saveState.textContent = '保存済み・反映を再試行';
        elements.feedback.textContent = `設定ファイルは保存しましたが、マスコットへの反映を確認できませんでした：${result.applyError || '応答がありません。'}`;
        elements.feedback.classList.add('is-error');
      }
      showToast('保存中に新しい変更が加わりました。もう一度保存してください。');
      return false;
    }

    applyNormalizedConfigToState(savedConfig, requestActionIds);
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

function selectedActionSavePayload(action, index) {
  if (!state.persistedSnapshot) {
    throw new Error('保存済み設定の基準を読み込めていません。設定を再読み込みしてから保存してください。');
  }
  const serializedAction = serializeAction(action, index);
  const config = structuredClone(state.persistedSnapshot.config);
  const actionIds = [...state.persistedSnapshot.actionIds];
  const savedIndex = actionIds.indexOf(action._uiId);

  if (savedIndex >= 0) {
    config.actions[savedIndex] = serializedAction;
    return { config, actionIds, actionIndex: savedIndex };
  }

  if (config.actions.length >= MAX_ACTIONS) {
    throw new Error(`保存済みの動作がすでに${MAX_ACTIONS}件あります。先に下部の「保存して反映」で一覧の削除を確定してください。`);
  }

  const workingIndex = state.actions.findIndex((candidate) => candidate._uiId === action._uiId);
  let insertionIndex = 0;
  for (let cursor = workingIndex - 1; cursor >= 0; cursor -= 1) {
    const neighborIndex = actionIds.indexOf(state.actions[cursor]._uiId);
    if (neighborIndex >= 0) {
      insertionIndex = neighborIndex + 1;
      break;
    }
  }
  config.actions.splice(insertionIndex, 0, serializedAction);
  actionIds.splice(insertionIndex, 0, action._uiId);
  return { config, actionIds, actionIndex: insertionIndex };
}

async function saveSelectedAction() {
  if (!state.apiAvailable) {
    disableUnavailableEditor();
    return false;
  }
  const action = selectedAction();
  if (!action) return false;
  if (state.busy) return false;
  if (!state.applyRetry && !isSelectedActionPending(action)) return false;

  const operation = beginOperation('save-selected-action');
  if (!operation) return false;
  try {
    const actionIndex = state.actions.findIndex((candidate) => candidate._uiId === action._uiId);
    const { config: payload, actionIds, actionIndex: previewIndex } = selectedActionSavePayload(action, actionIndex);
    const requestActionId = action._uiId;
    const submittedActionName = payload.actions[previewIndex]?.name || action.name || '選択中の動作';
    const revisionAtStart = state.revision;
    elements.feedback.textContent = `「${submittedActionName}」を保存し、マスコットへの反映を確認しています…`;
    elements.feedback.classList.remove('is-error');
    const result = await window.mascotAPI.saveConfig(payload, previewIndex);
    if (!result?.ok) throw new Error('選択中の動作を保存できませんでした。');

    const savedConfig = result.config || payload;
    setPersistedSnapshot(savedConfig, actionIds);
    markMigrationsPersisted();
    state.applyRetry = !result.applied;
    const savedIndex = actionIds.indexOf(requestActionId);
    const persistedActionName = savedConfig.actions?.[savedIndex]?.name
      || payload.actions[savedIndex]?.name
      || submittedActionName;
    if (state.revision === revisionAtStart) {
      const currentIndex = state.actions.findIndex((candidate) => candidate._uiId === requestActionId);
      const savedAction = savedConfig.actions?.[savedIndex] || payload.actions[savedIndex];
      if (currentIndex >= 0 && savedAction) {
        const currentAction = state.actions[currentIndex];
        state.actions[currentIndex] = editableActionFromConfig(savedAction, currentAction, requestActionId);
      }
    }

    if (!result.applied) {
      const message = `設定ファイルは保存しましたが、マスコットへの反映を確認できませんでした：${result.applyError || '応答がありません。'}`;
      markApplyRetry(message);
      renderActionList();
      renderEditor();
      showToast(`「${persistedActionName}」の反映を確認できませんでした。もう一度保存すると再試行できます。`, true);
      return false;
    }

    refreshPendingStatus(
      '未保存の変更',
      hasPendingChanges()
        ? '選択中の動作を保存して反映しました。他の設定や保存中の追加編集はまだ保存されていません。'
        : '選択中の動作を保存し、マスコットへの反映を確認しました。',
    );
    renderActionList();
    renderEditor();
    if (state.dirty) {
      showToast(`「${persistedActionName}」を保存して反映しました。他の設定や追加編集は未保存です。`);
    } else {
      showToast(`「${persistedActionName}」を保存し、マスコットへの反映を確認しました。`);
    }
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

elements.mascotSize.addEventListener('input', () => {
  if (!state.config?.mascot) return;
  state.config.mascot.size = numberOr(elements.mascotSize.value, 180);
  elements.mascotSizeOutput.textContent = `${elements.mascotSize.value} px`;
  markDirty();
  refreshPreviewGeometry();
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
  const previewAction = selectedAction();
  editSelectedAction((action) => {
    action.movement.speed = readNumberInput(elements.movementSpeed.value);
  });
  elements.speedOutput.textContent = elements.movementSpeed.value;
  startMovementSpeedPreview(previewAction);
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
elements.durationBulkDurationEnabled.addEventListener('change', () => {
  const enabled = elements.durationBulkDurationEnabled.checked;
  elements.durationBulkMin.disabled = !enabled;
  elements.durationBulkMax.disabled = !enabled;
  updateDurationBulkCount();
});
elements.durationBulkSpeedEnabled.addEventListener('change', () => {
  elements.durationBulkSpeed.disabled = !elements.durationBulkSpeedEnabled.checked;
  updateDurationBulkCount();
});
elements.movementSpeedPreviewStop.addEventListener('click', () => {
  stopMovementSpeedPreview('プレビューを停止しました。速さを変更すると再生できます。');
});
elements.imageEditButton.addEventListener('click', openImageEditor);
setupDropzone(elements.actionDropzone, 'actions', applyImportedActionImage);
setupDropzone(elements.effectDropzone, 'effects', applyImportedEffectImage);

elements.prepareReleaseButton.addEventListener('click', prepareDistributionDefaults);
elements.recoveryBackup.addEventListener('click', () => recoverConfiguration('backup'));
elements.recoveryDefaults.addEventListener('click', () => recoverConfiguration('defaults'));
elements.reloadButton.addEventListener('click', () => loadConfiguration({ askBeforeDiscard: true }));
elements.headerSaveButton.addEventListener('click', saveConfiguration);
elements.saveButton.addEventListener('click', saveConfiguration);
elements.saveSelectedAction.addEventListener('click', saveSelectedAction);

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());
window.addEventListener('pagehide', () => stopMovementSpeedPreview());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopMovementSpeedPreview();
});
elements.actionActualSize.addEventListener('click', () => openActualSizePreview(() => ({ action: selectedAction() })));
elements.effectActualSize.addEventListener('click', () => openActualSizePreview(() => ({
  action: selectedAction(), effect: selectedAction()?.effect,
})));
elements.actualSizeClose.addEventListener('click', closeActualSizePreview);
elements.actualSizeDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeActualSizePreview();
});
elements.actualSizeDialog.addEventListener('close', () => {
  if (!elements.actualSizeDialog.open) actualSizeSource = null;
});
for (const image of [
  elements.actionPreview, elements.imageEditorPreview, elements.effectLiveMascotImage,
  elements.effectLiveImage, elements.actualSizeImage, elements.actualSizeEffect,
]) {
  image.addEventListener('load', refreshPreviewGeometry);
  image.addEventListener('error', refreshPreviewGeometry);
}
window.addEventListener('resize', refreshPreviewGeometry);
if (typeof ResizeObserver !== 'undefined') {
  const previewResizeObserver = new ResizeObserver(refreshPreviewGeometry);
  for (const container of [elements.actionDropzone, elements.imageControlStack, elements.imageEditorStage, elements.sizeManagerGrid, elements.effectLivePreview]) {
    previewResizeObserver.observe(container);
  }
  window.addEventListener('beforeunload', () => previewResizeObserver.disconnect());
}
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

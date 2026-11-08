(function exposeConfigRules(root, factory) {
  const configRules = factory();
  if (typeof module === 'object' && module.exports) module.exports = configRules;
  else root.DesktopMascotConfigRules = configRules;
})(globalThis, function createConfigRules() {
  'use strict';

const ALLOWED_MOVEMENTS = Object.freeze([
  'still',
  'horizontal',
  'wander',
  'fall',
  'launch',
  'orthogonal',
]);

const ALLOWED_FLIP_MODES = Object.freeze(['direction', 'none', 'random']);
const ALLOWED_START_POSITIONS = Object.freeze([
  'bottom-right',
  'bottom-left',
  'top-right',
  'top-left',
  'center',
]);

const DEFAULT_DURATION_MS = Object.freeze([6000, 10000]);

const CONFIG_RULES = Object.freeze({
  actionCount: Object.freeze({ minimum: 1, maximum: 100 }),
  weight: Object.freeze({ minimum: 1, maximum: 10, integer: true }),
  durationMs: Object.freeze({ minimum: 500, maximum: 600000, integer: true }),
  mascotSize: Object.freeze({ minimum: 32, maximum: 1000 }),
  margin: Object.freeze({ minimum: 0, maximum: 1000 }),
  movementSpeed: Object.freeze({ minimum: 0, maximum: 2000 }),
  imageScale: Object.freeze({ minimum: 0.3, maximum: 3 }),
  imageOffset: Object.freeze({ minimum: -100, maximum: 100 }),
  effectIntervalMs: Object.freeze({ minimum: 50, maximum: 60000, integer: true }),
  effectSize: Object.freeze({ minimum: 4, maximum: 1000 }),
  effectLifetimeMs: Object.freeze({ minimum: 50, maximum: 60000, integer: true }),
  effectOffset: Object.freeze({ minimum: -5000, maximum: 5000 }),
});

const MOVEMENT_SET = new Set(ALLOWED_MOVEMENTS);
const FLIP_MODE_SET = new Set(ALLOWED_FLIP_MODES);
const START_POSITION_SET = new Set(ALLOWED_START_POSITIONS);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function objectOrDefault(parent, key, field) {
  if (!hasOwn(parent, key) || parent[key] === undefined) return {};
  if (!isRecord(parent[key])) throw new Error(`${field} はオブジェクトにしてください。`);
  return parent[key];
}

function numberOrDefault(parent, key, field, rule, fallback, { integer = false } = {}) {
  if (!hasOwn(parent, key) || parent[key] === undefined) return fallback;
  const value = parent[key];
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < rule.minimum
    || value > rule.maximum
    || (integer && !Number.isInteger(value))
  ) {
    const kind = integer ? '整数' : '数値';
    throw new Error(`${field} は${rule.minimum}〜${rule.maximum}の${kind}にしてください。`);
  }
  return value;
}

function booleanOrDefault(parent, key, field, fallback) {
  if (!hasOwn(parent, key) || parent[key] === undefined) return fallback;
  if (typeof parent[key] !== 'boolean') throw new Error(`${field} はtrueまたはfalseにしてください。`);
  return parent[key];
}

function enumOrDefault(parent, key, field, allowed, fallback) {
  if (!hasOwn(parent, key) || parent[key] === undefined) return fallback;
  if (typeof parent[key] !== 'string' || !allowed.has(parent[key])) {
    throw new Error(`${field} が対応していません。`);
  }
  return parent[key];
}

function requiredText(parent, key, field) {
  if (typeof parent[key] !== 'string' || parent[key].trim() === '') {
    throw new Error(`${field} を空にできません。`);
  }
  return parent[key].trim();
}

function validateAssetReference(relativePath, field, validateAsset) {
  if (typeof validateAsset !== 'function') return;
  try {
    validateAsset(relativePath, field);
  } catch (error) {
    throw new Error(`${field} を使用できません：${String(error?.message || error)}`);
  }
}

function normalizeDuration(action, field) {
  if (!hasOwn(action, 'durationMs') || action.durationMs === undefined) return [...DEFAULT_DURATION_MS];
  const duration = action.durationMs;
  const rule = CONFIG_RULES.durationMs;
  if (
    !Array.isArray(duration)
    || duration.length !== 2
    || duration.some((value) => (
      typeof value !== 'number'
      || !Number.isFinite(value)
      || !Number.isInteger(value)
      || value < rule.minimum
      || value > rule.maximum
    ))
    || duration[0] > duration[1]
  ) {
    throw new Error(
      `${field}.durationMs は${rule.minimum}〜${rule.maximum}msの整数2件で、最短≦最長にしてください。`,
    );
  }
  return [...duration];
}

function normalizeEffect(action, actionField, validateAsset) {
  if (!hasOwn(action, 'effect') || action.effect === undefined || action.effect === null) return undefined;
  if (!isRecord(action.effect)) throw new Error(`${actionField}.effect はオブジェクトにしてください。`);
  const effect = action.effect;
  const field = `${actionField}.effect`;
  const file = requiredText(effect, 'file', `${field}.file`);
  validateAssetReference(file, `${field}.file`, validateAsset);

  let coordinateVersion = 1;
  if (hasOwn(effect, 'coordinateVersion') && effect.coordinateVersion !== undefined) {
    if (!Number.isInteger(effect.coordinateVersion) || ![1, 2].includes(effect.coordinateVersion)) {
      throw new Error(`${field}.coordinateVersion は1または2にしてください。`);
    }
    coordinateVersion = effect.coordinateVersion;
  }
  const usesUpPositiveCoordinates = coordinateVersion === 2;
  const storedOffsetY = numberOrDefault(
    effect,
    'offsetY',
    `${field}.offsetY`,
    CONFIG_RULES.effectOffset,
    usesUpPositiveCoordinates ? 12 : -12,
  );

  return {
    file,
    intervalMs: numberOrDefault(
      effect,
      'intervalMs',
      `${field}.intervalMs`,
      CONFIG_RULES.effectIntervalMs,
      450,
      { integer: true },
    ),
    size: numberOrDefault(effect, 'size', `${field}.size`, CONFIG_RULES.effectSize, 32),
    lifetimeMs: numberOrDefault(
      effect,
      'lifetimeMs',
      `${field}.lifetimeMs`,
      CONFIG_RULES.effectLifetimeMs,
      1800,
      { integer: true },
    ),
    offsetX: numberOrDefault(effect, 'offsetX', `${field}.offsetX`, CONFIG_RULES.effectOffset, 0),
    offsetY: usesUpPositiveCoordinates ? storedOffsetY : -storedOffsetY,
    coordinateVersion: 2,
    emitWhileStill: booleanOrDefault(effect, 'emitWhileStill', `${field}.emitWhileStill`, false),
  };
}

function normalizeAction(action, index, validateAsset) {
  const field = `actions[${index}]`;
  if (!isRecord(action)) throw new Error(`${field} は動作のオブジェクトにしてください。`);
  const name = requiredText(action, 'name', `${field}.name`);
  const file = requiredText(action, 'file', `${field}.file`);
  validateAssetReference(file, `${field}.file`, validateAsset);

  const movementInput = objectOrDefault(action, 'movement', `${field}.movement`);
  const movementType = enumOrDefault(
    movementInput,
    'type',
    `${field}.movement.type`,
    MOVEMENT_SET,
    'still',
  );
  const transformInput = objectOrDefault(action, 'imageTransform', `${field}.imageTransform`);

  let legacyFlipMode = 'direction';
  if (hasOwn(action, 'flipWithDirection') && action.flipWithDirection !== undefined) {
    if (typeof action.flipWithDirection !== 'boolean') {
      throw new Error(`${field}.flipWithDirection はtrueまたはfalseにしてください。`);
    }
    legacyFlipMode = action.flipWithDirection ? 'direction' : 'none';
  }
  const flipMode = enumOrDefault(action, 'flipMode', `${field}.flipMode`, FLIP_MODE_SET, legacyFlipMode);
  const effect = normalizeEffect(action, field, validateAsset);

  return {
    name,
    file,
    weight: numberOrDefault(
      action,
      'weight',
      `${field}.weight`,
      CONFIG_RULES.weight,
      1,
      { integer: true },
    ),
    durationMs: normalizeDuration(action, field),
    flipMode,
    imageTransform: {
      flipX: booleanOrDefault(
        transformInput,
        'flipX',
        `${field}.imageTransform.flipX`,
        false,
      ),
      scale: numberOrDefault(
        transformInput,
        'scale',
        `${field}.imageTransform.scale`,
        CONFIG_RULES.imageScale,
        1,
      ),
      offsetX: numberOrDefault(
        transformInput,
        'offsetX',
        `${field}.imageTransform.offsetX`,
        CONFIG_RULES.imageOffset,
        0,
      ),
      offsetY: numberOrDefault(
        transformInput,
        'offsetY',
        `${field}.imageTransform.offsetY`,
        CONFIG_RULES.imageOffset,
        0,
      ),
    },
    movement: {
      type: movementType,
      speed: numberOrDefault(
        movementInput,
        'speed',
        `${field}.movement.speed`,
        CONFIG_RULES.movementSpeed,
        movementType === 'still' ? 0 : 55,
      ),
    },
    ...(effect ? { effect } : {}),
  };
}

function validateAndNormalizeConfig(input, { validateAsset } = {}) {
  if (!isRecord(input)) throw new Error('設定データはオブジェクトにしてください。');
  if (!Array.isArray(input.actions) || input.actions.length < CONFIG_RULES.actionCount.minimum) {
    throw new Error('actions は動作を1件以上含む配列にしてください。');
  }
  if (input.actions.length > CONFIG_RULES.actionCount.maximum) {
    throw new Error(`actions は${CONFIG_RULES.actionCount.maximum}件までにしてください。`);
  }
  const mascotInput = objectOrDefault(input, 'mascot', 'mascot');
  let name = 'マスコット';
  if (hasOwn(input, 'name') && input.name !== undefined) {
    if (typeof input.name !== 'string') throw new Error('name は文字列にしてください。');
    name = input.name.trim() || 'マスコット';
  }

  return {
    name,
    mascot: {
      size: numberOrDefault(
        mascotInput,
        'size',
        'mascot.size',
        CONFIG_RULES.mascotSize,
        180,
      ),
      startPosition: enumOrDefault(
        mascotInput,
        'startPosition',
        'mascot.startPosition',
        START_POSITION_SET,
        'bottom-right',
      ),
      margin: numberOrDefault(
        mascotInput,
        'margin',
        'mascot.margin',
        CONFIG_RULES.margin,
        40,
      ),
      rememberPosition: booleanOrDefault(
        mascotInput,
        'rememberPosition',
        'mascot.rememberPosition',
        true,
      ),
    },
    actions: input.actions.map((action, index) => normalizeAction(action, index, validateAsset)),
  };
}

return Object.freeze({
  ALLOWED_MOVEMENTS,
  ALLOWED_FLIP_MODES,
  ALLOWED_START_POSITIONS,
  DEFAULT_DURATION_MS,
  CONFIG_RULES,
  validateAndNormalizeConfig,
});
});

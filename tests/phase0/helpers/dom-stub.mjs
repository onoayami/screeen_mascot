export function createElementStub(id = '', tagName = 'div') {
  const listeners = new Map();
  const classes = new Set();
  const node = {
    id,
    tagName: String(tagName).toUpperCase(),
    style: {
      setProperty(name, value) { this[name] = value; },
      removeProperty(name) { delete this[name]; },
    },
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      toggle(name, force) {
        if (force === true) classes.add(name);
        else if (force === false) classes.delete(name);
        else if (classes.has(name)) classes.delete(name);
        else classes.add(name);
        return classes.has(name);
      },
      contains(name) { return classes.has(name); },
    },
    dataset: {},
    children: [],
    hidden: false,
    disabled: false,
    checked: false,
    value: '',
    textContent: '',
    open: false,
    width: 1,
    height: 1,
    naturalWidth: 1,
    naturalHeight: 1,
    src: '',
    alt: '',
    onclick: null,
    oninput: null,
    oncancel: null,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const current = listeners.get(type) || [];
      listeners.set(type, current.filter((candidate) => candidate !== listener));
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener.call(this, event);
    },
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    replaceChildren(...items) { this.children = [...items]; },
    setAttribute(name, value) { this[name] = String(value); },
    removeAttribute(name) { delete this[name]; },
    focus() {},
    select() {},
    remove() { this.removed = true; },
    showModal() { this.open = true; },
    close() { this.open = false; },
    hasPointerCapture() { return false; },
    releasePointerCapture() {},
    setPointerCapture() {},
    querySelector(selector) {
      if (selector === 'img') return this.children.find((child) => child?.tagName === 'IMG') || null;
      return null;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 420, height: 300, right: 420, bottom: 300 };
    },
    getContext() {
      return {
        clearRect() {},
        drawImage() {},
        putImageData() {},
        getImageData() {
          return { width: 1, height: 1, data: new Uint8ClampedArray(4) };
        },
      };
    },
    toBlob(callback) { callback(new Blob()); },
    _listeners: listeners,
    _classes: classes,
  };
  return node;
}

export function createDomStub() {
  const nodes = new Map();
  const documentListeners = new Map();
  const documentElement = createElementStub('documentElement', 'html');
  const document = {
    hidden: false,
    documentElement,
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, createElementStub(id));
      return nodes.get(id);
    },
    createElement(tagName) { return createElementStub('', tagName); },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      for (const listener of documentListeners.get(event.type) || []) listener(event);
    },
  };
  return { document, nodes, documentListeners };
}

export function createWindowEventTarget(base = {}) {
  const listeners = new Map();
  return {
    ...base,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const current = listeners.get(type) || [];
      listeners.set(type, current.filter((candidate) => candidate !== listener));
    },
    dispatch(type, event = {}) {
      const payload = { type, preventDefault() {}, stopPropagation() {}, ...event };
      for (const listener of listeners.get(type) || []) listener(payload);
      return payload;
    },
    _listeners: listeners,
  };
}

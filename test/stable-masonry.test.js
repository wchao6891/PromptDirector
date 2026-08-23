import test from "node:test";
import assert from "node:assert/strict";

import { createStableMasonry } from "../stable-masonry.js";

test("card resize defers ancestor height writes until after ResizeObserver delivery", () => {
  const originals = {
    HTMLElement: globalThis.HTMLElement,
    ResizeObserver: globalThis.ResizeObserver,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    getComputedStyle: globalThis.getComputedStyle,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    window: globalThis.window
  };
  const observers = [];
  const frames = [];
  let deliveringResize = false;
  const resizeObserverErrors = [];

  class FakeElement {}
  const container = new FakeElement();
  container.clientWidth = 600;
  container.style = new Proxy({}, {
    set(target, property, value) {
      if (property === "height" && deliveringResize) {
        resizeObserverErrors.push("ResizeObserver loop completed with undelivered notifications.");
      }
      target[property] = value;
      return true;
    }
  });
  container.getBoundingClientRect = () => ({ top: 0 });
  container.querySelectorAll = () => [card];

  const card = new FakeElement();
  card.dataset = {};
  card.isConnected = true;
  card.style = {};
  card.getBoundingClientRect = () => ({ top: 0, bottom: 100, height: 100 });

  globalThis.HTMLElement = FakeElement;
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
    disconnect() {}
  };
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = () => undefined;
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (name) => name === "--masonry-card-min-width" ? "270" : "12"
  });
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    innerHeight: 800,
    innerWidth: 1000,
    scrollBy() {},
    scrollY: 0
  };

  try {
    const masonry = createStableMasonry(container);
    masonry.append([card]);
    assert.equal(container.style.height, "100px");

    deliveringResize = true;
    observers[0].callback([{ target: card, borderBoxSize: { blockSize: 180 } }]);
    deliveringResize = false;

    assert.deepEqual(resizeObserverErrors, []);
    assert.equal(container.style.height, "100px");
    frames.shift()?.();
    assert.equal(container.style.height, "180px");

    deliveringResize = true;
    observers[0].callback([{ target: card, borderBoxSize: { blockSize: 240 } }]);
    deliveringResize = false;
    masonry.append([]);
    assert.deepEqual(resizeObserverErrors, []);
    assert.equal(container.style.height, "240px");
    masonry.destroy();
  } finally {
    Object.assign(globalThis, originals);
  }
});

test("removing one card only compacts its original column", () => {
  const originals = {
    HTMLElement: globalThis.HTMLElement,
    ResizeObserver: globalThis.ResizeObserver,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    getComputedStyle: globalThis.getComputedStyle,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    window: globalThis.window
  };
  class FakeElement {
    constructor(height = 0) {
      this.height = height;
      this.dataset = {};
      this.style = {};
      this.isConnected = true;
    }
    getBoundingClientRect() {
      const top = Number.parseFloat(this.style.top || "0");
      return { top, bottom: top + this.height, height: this.height };
    }
    remove() { this.isConnected = false; }
  }
  const cards = [new FakeElement(100), new FakeElement(120), new FakeElement(80)];
  const container = new FakeElement();
  container.clientWidth = 600;
  container.querySelectorAll = () => cards.filter((card) => card.isConnected);
  globalThis.HTMLElement = FakeElement;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => undefined;
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (name) => name === "--masonry-card-min-width" ? "270" : "12"
  });
  globalThis.window = {
    addEventListener() {}, removeEventListener() {}, innerHeight: 800, innerWidth: 1000,
    scrollBy() {}, scrollY: 0
  };

  try {
    const masonry = createStableMasonry(container);
    masonry.append(cards);
    assert.deepEqual(cards.map((card) => card.dataset.masonryColumn), ["0", "1", "0"]);
    const untouched = { left: cards[1].style.left, top: cards[1].style.top };
    assert.equal(masonry.remove(cards[0]), true);
    assert.equal(cards[2].style.top, "0px");
    assert.deepEqual({ left: cards[1].style.left, top: cards[1].style.top }, untouched);
    masonry.destroy();
  } finally {
    Object.assign(globalThis, originals);
  }
});

test("custom scroll container owns visibility tracking and anchor restoration", () => {
  const originals = {
    HTMLElement: globalThis.HTMLElement,
    ResizeObserver: globalThis.ResizeObserver,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    getComputedStyle: globalThis.getComputedStyle,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    window: globalThis.window
  };
  const rootListeners = new Map();
  const windowListeners = new Map();
  const rootScrolls = [];
  const frames = [];

  class FakeElement {
    constructor(height = 0) {
      this.height = height;
      this.dataset = {};
      this.style = {};
      this.isConnected = true;
      this.clientWidth = 250;
      this.scrollTop = 300;
    }
    addEventListener(type, listener) { rootListeners.set(type, listener); }
    removeEventListener(type) { rootListeners.delete(type); }
    getBoundingClientRect() {
      const top = Number.parseFloat(this.style.top || "0");
      return { top, bottom: top + this.height, height: this.height };
    }
    remove() { this.isConnected = false; }
    scrollBy(_left, top) {
      this.scrollTop += top;
      rootScrolls.push(top);
    }
  }

  const cards = [new FakeElement(100), new FakeElement(120)];
  const container = new FakeElement();
  container.querySelectorAll = () => cards.filter((card) => card.isConnected);
  const scrollContainer = new FakeElement(400);
  scrollContainer.getBoundingClientRect = () => ({ top: 100, bottom: 500, height: 400 });

  globalThis.HTMLElement = FakeElement;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = () => undefined;
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (name) => name === "--masonry-card-min-width" ? "270" : "12"
  });
  globalThis.window = {
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener(type) { windowListeners.delete(type); },
    innerHeight: 800,
    innerWidth: 1000,
    scrollBy() { throw new Error("window scroll must remain unchanged"); },
    scrollY: 0
  };

  try {
    const masonry = createStableMasonry(container, { scrollContainer });
    masonry.append(cards);
    assert.equal(rootListeners.has("scroll"), true);
    assert.equal(windowListeners.has("scroll"), false);

    rootListeners.get("scroll")();
    frames.shift()?.();
    assert.equal(masonry.remove(cards[0]), true);
    assert.deepEqual(rootScrolls, [-112]);
    assert.equal(scrollContainer.scrollTop, 188);

    masonry.destroy();
    assert.equal(rootListeners.has("scroll"), false);
  } finally {
    Object.assign(globalThis, originals);
  }
});

test("reset keeps the committed wall height while replacement cards are measured", () => {
  const originals = {
    HTMLElement: globalThis.HTMLElement,
    ResizeObserver: globalThis.ResizeObserver,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    getComputedStyle: globalThis.getComputedStyle,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    window: globalThis.window
  };
  const frames = [];

  class FakeElement {
    constructor(height = 0) {
      this.height = height;
      this.dataset = {};
      this.style = {};
      this.isConnected = true;
    }
    getBoundingClientRect() {
      const top = Number.parseFloat(this.style.top || "0");
      return { top, bottom: top + this.height, height: this.height };
    }
  }

  const cards = [new FakeElement(120), new FakeElement(140)];
  const container = new FakeElement();
  container.style.height = "260px";
  Object.defineProperty(container, "clientWidth", {
    get() { return container.style.height === "0px" ? 615 : 600; }
  });
  container.querySelectorAll = () => cards;

  globalThis.HTMLElement = FakeElement;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = () => undefined;
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (name) => name === "--masonry-card-min-width" ? "270" : "12"
  });
  globalThis.window = {
    addEventListener() {}, removeEventListener() {}, innerHeight: 800, innerWidth: 1000,
    scrollBy() {}, scrollY: 0
  };

  try {
    const masonry = createStableMasonry(container);
    masonry.reset();
    assert.equal(container.style.height, "260px");
    masonry.append(cards);
    assert.equal(cards[0].style.width, "294px");
    assert.equal(cards[1].style.left, "306px");
    assert.equal(cards[1].style.width, "294px");
    assert.equal(container.style.height, "140px");
    frames.shift()?.();
    assert.equal(cards[1].style.width, "294px");
    masonry.destroy();
  } finally {
    Object.assign(globalThis, originals);
  }
});

test("scrollbar-sized container width changes are rechecked and corrected on the next frame", () => {
  const originals = {
    HTMLElement: globalThis.HTMLElement,
    ResizeObserver: globalThis.ResizeObserver,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    getComputedStyle: globalThis.getComputedStyle,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    window: globalThis.window
  };
  const frames = [];
  const observers = [];
  let width = 600;

  class FakeElement {
    constructor(height = 0) {
      this.height = height;
      this.dataset = {};
      this.style = {};
      this.isConnected = true;
    }
    getBoundingClientRect() {
      const top = Number.parseFloat(this.style.top || "0");
      return { top, bottom: top + this.height, height: this.height };
    }
  }

  const cards = [new FakeElement(120), new FakeElement(140)];
  const container = new FakeElement();
  Object.defineProperty(container, "clientWidth", { get: () => width });
  container.querySelectorAll = () => cards;

  globalThis.HTMLElement = FakeElement;
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      observers.push(this);
    }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  };
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = () => undefined;
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (name) => name === "--masonry-card-min-width" ? "270" : "12"
  });
  globalThis.window = {
    addEventListener() {}, removeEventListener() {}, innerHeight: 800, innerWidth: 1000,
    scrollBy() {}, scrollY: 0
  };

  try {
    const masonry = createStableMasonry(container);
    masonry.append(cards);
    while (frames.length) frames.shift()?.();
    const containerObserver = observers.find((observer) => observer.targets.has(container));
    assert.ok(containerObserver);
    assert.equal(cards[0].style.width, "294px");

    width = 615;
    containerObserver.callback([{ target: container }]);
    assert.equal(cards[0].style.width, "294px");
    width = 600;
    frames.shift()?.();
    assert.equal(cards[0].style.width, "294px");

    width = 615;
    containerObserver.callback([{ target: container }]);
    assert.equal(cards[0].style.width, "294px");
    frames.shift()?.();
    assert.equal(cards[0].style.width, "301.5px");
    assert.equal(cards[1].style.left, "313.5px");
    assert.equal(Number.parseFloat(cards[1].style.left) + Number.parseFloat(cards[1].style.width), 615);
    masonry.destroy();
  } finally {
    Object.assign(globalThis, originals);
  }
});

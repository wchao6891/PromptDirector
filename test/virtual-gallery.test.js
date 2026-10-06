import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = (await readFile(new URL('../extension/virtual-gallery.js', import.meta.url), 'utf8')).replace('export function', 'function');
function fixture(minimum = 270) {
  const observers = [], frames = new Map(), cards = new Map(), released = [];
  let scrollY = 0, frameId = 0;
  const container = {children: [], style: {}, dataset: {}, clientWidth: 1120,
    getBoundingClientRect: () => ({top: -scrollY}),
    append(card) {this.children.push(card); card.parent = this;},
    insertBefore(card, before) {this.children = this.children.filter(c => c !== card); const i = this.children.indexOf(before); this.children.splice(i < 0 ? this.children.length : i, 0, card);}
  };
  function createCard(id) {
    const card = {dataset: {entryId: id}, style: {}, imageHeight: 220,
      get isConnected() {return container.children.includes(this);},
      getBoundingClientRect() {const height = 40 + this.imageHeight * (Number.parseFloat(this.style.width || 270) / 270);
        const top = Number.parseFloat(this.style.top || 0) - scrollY; return {height, top, bottom: top + height};},
      contains: () => false,
      remove() {container.children = container.children.filter(c => c !== this);}
    }; cards.set(id, card); return card;
  }
  const ctx = {Math, Number, Array, Set, Map,
    window: {innerHeight: 900, addEventListener() {}, removeEventListener() {}, scrollBy(x, y) {scrollY += y;}},
    document: {querySelector: () => null, activeElement: null},
    getComputedStyle: () => ({getPropertyValue: key => ({'--masonry-gap': '12', '--masonry-card-min-width': String(minimum), '--list-thumb': '32'}[key] || '0')}),
    ResizeObserver: class {constructor(callback) {this.callback = callback; observers.push(this);} observe() {} unobserve() {} disconnect() {}},
    requestAnimationFrame: callback => {frames.set(++frameId, callback); return frameId;}, cancelAnimationFrame: id => frames.delete(id)
  };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  const gallery = ctx.createVirtualGallery(container, {mode: () => 'waterfall', createCard,
    releaseCard: card => released.push(card.dataset.entryId)});
  const flush = () => {for (let i = 0; frames.size && i < 20; i++) {const batch = [...frames.values()]; frames.clear(); batch.forEach(cb => cb());} assert.equal(frames.size, 0);};
  return {gallery, cards, container, released, createCard, flush,
    resizeCards() {observers[0].callback(container.children.map(target => ({target}))); flush();},
    scroll(y) {scrollY = y; observers[1].callback([]); flush();},
    zoom(min) {gallery.resize(() => {minimum = min;}); flush();}
  };
}

test('late image heights keep existing cards in their original columns', () => {
  const f = fixture(); const cards = Array.from({length: 24}, (_, i) => f.createCard(String(i)));
  cards.forEach(c => f.container.append(c)); f.gallery.append(cards);
  const before = new Map(cards.map(c => [c.dataset.entryId, c.style.left]));
  cards[0].imageHeight = 800; f.resizeCards();
  for (const card of f.container.children) assert.equal(card.style.left, before.get(card.dataset.entryId));
});

test('minimum-size grid recycles DOM cards and restores the same cases on return', () => {
  const f = fixture(140); const cards = Array.from({length: 600}, (_, i) => f.createCard(String(i)));
  cards.forEach(c => f.container.append(c)); f.gallery.append(cards);
  const firstIds = f.container.children.map(c => c.dataset.entryId);
  assert.ok(firstIds.length < 300);
  f.scroll(8000); assert.ok(f.released.includes('0'));
  f.scroll(0);
  assert.deepEqual(f.container.children.map(c => c.dataset.entryId), firstIds);
  assert.equal(f.gallery.count, 600);
});

test('zooming down to minimum and back retains the visible case and its screen position', () => {
  const f = fixture(); const cards = Array.from({length: 120}, (_, i) => f.createCard(String(i)));
  cards.forEach(c => f.container.append(c)); f.gallery.append(cards); f.scroll(2000);
  const anchor = f.container.children.filter(c => {const r = c.getBoundingClientRect(); return r.bottom > 0 && r.top < 900;})
    .sort((a, b) => Number.parseFloat(a.style.top) - Number.parseFloat(b.style.top))[0];
  const top = anchor.getBoundingClientRect().top;
  f.zoom(140);
  assert.ok(anchor.isConnected); assert.ok(Math.abs(anchor.getBoundingClientRect().top - top) <= 1);
  f.zoom(270);
  assert.ok(anchor.isConnected); assert.ok(Math.abs(anchor.getBoundingClientRect().top - top) <= 1);
});

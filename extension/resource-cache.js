// Evict only resources that consumers have released. A protected working set
// may temporarily exceed the budget; retry trimming when it is unmounted.
export class ResourceCache extends Map {
  constructor({ maxEntries, maxBytes = Infinity, cost = () => 1, protectedValue = () => false, dispose = () => {} }) {
    super(); this.policy = { maxEntries, maxBytes, cost, protectedValue, dispose };
  }
  get(key) {
    if (!super.has(key)) return undefined;
    const value = super.get(key); super.delete(key); super.set(key, value); return value;
  }
  set(key, value) {
    const previous = super.get(key);
    super.delete(key);
    if (previous !== undefined && previous !== value) this.release(previous); super.set(key, value); this.trim(key); return this;
  }
  trim(incomingKey) {
    let bytes = [...this.values()].reduce((sum, value) => sum + this.policy.cost(value), 0);
    for (const [key, value] of this) {
      if (this.size <= this.policy.maxEntries && bytes <= this.policy.maxBytes) break;
      if (key === incomingKey || this.policy.protectedValue(value, key)) continue;
      super.delete(key); bytes -= this.policy.cost(value); this.release(value);
    }
  }
  release(value) {
    if (![...this.values()].includes(value)) this.policy.dispose(value);
  }
}

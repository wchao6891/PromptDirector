// Storage round-trips may reorder object keys. Arrays retain their meaningful order.
export function serializeUndoState(value) {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  });
}

export function sameUndoState(left, right) {
  return serializeUndoState(left) === serializeUndoState(right);
}

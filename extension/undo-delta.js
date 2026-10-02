import { MEDIA_FINGERPRINT_CHUNK_BYTES } from './resource-limits.js';
import { sha256 } from './vendor/noble-hashes/sha2.js';

export function undoDigest(value) {
  const hash = sha256.create(), encoder = new TextEncoder();
  try {
    for (const part of canonicalChunks(value)) hash.update(encoder.encode(part));
    return Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
  } finally { hash.destroy(); }
}

// Match stable JSON without building full escaped and encoded library copies.
function* canonicalChunks(value) {
  if (value instanceof Date) value = value.toJSON();
  if (typeof value === 'string') {
    yield '"';
    const chunkCharacters = MEDIA_FINGERPRINT_CHUNK_BYTES / 128;
    for (let start = 0; start < value.length;) {
      let end = Math.min(value.length, start + chunkCharacters);
      const last = value.charCodeAt(end - 1), next = value.charCodeAt(end);
      if (end < value.length && last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
      yield JSON.stringify(value.slice(start, end)).slice(1, -1); start = end;
    }
    yield '"'; return;
  }
  if (Array.isArray(value)) {
    yield '[';
    for (let index = 0; index < value.length; index++) {
      if (index) yield ',';
      yield* canonicalChunks(value[index] === undefined ? null : value[index]);
    }
    yield ']'; return;
  }
  if (value && typeof value === 'object') {
    yield '{'; let count = 0;
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined || typeof value[key] === 'function' || typeof value[key] === 'symbol') continue;
      if (count++) yield ',';
      yield JSON.stringify(key); yield ':'; yield* canonicalChunks(value[key]);
    }
    yield '}'; return;
  }
  yield JSON.stringify(value) || '';
}

// Keep only old values of changed fields. A digest of the complete post-state
// still refuses rollback after any subsequent user edit.
export function inverseChanges(before, after, path = []) {
  if (before === after) return [];
  const dictionaries = value => value && typeof value === 'object' && !Array.isArray(value);
  if (dictionaries(before) && dictionaries(after) || Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => {
      const child = [...path, key];
      if (!Object.hasOwn(before, key)) return [{ path: child, existed: false }];
      if (!Object.hasOwn(after, key)) return [{ path: child, existed: true, value: structuredClone(before[key]) }];
      return inverseChanges(before[key], after[key], child);
    });
  }
  return [{ path, existed: true, value: structuredClone(before) }];
}

export function restoreChanges(current, changes) {
  let result = structuredClone(current);
  for (const change of changes) {
    if (!change.path.length) { result = structuredClone(change.value); continue; }
    let target = result;
    for (const key of change.path.slice(0, -1)) {
      if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) throw new Error('撤回记录与当前资料结构不符');
      target = target[key];
    }
    const key = change.path.at(-1);
    if (change.existed) Object.defineProperty(target, key, { value: structuredClone(change.value), writable: true, configurable: true, enumerable: true });
    else delete target[key];
  }
  return result;
}

export function isInverseChanges(value) {
  return Array.isArray(value) && value.every(change => Array.isArray(change?.path) && change.path.every(key => typeof key === 'string')
    && typeof change.existed === 'boolean' && (!change.existed || Object.hasOwn(change, 'value')));
}

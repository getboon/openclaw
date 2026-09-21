/** Prunes a Map in insertion order until it fits the requested maximum size. */
export function pruneMapToMaxSize<K, V>(map: Map<K, V>, maxSize: number): void {
  if (Number.isNaN(maxSize) || maxSize === Number.POSITIVE_INFINITY) {
    // Treat "unknown" or unlimited sizes as no-op so callers can wire optional caps directly.
    return;
  }
  const limit = Math.max(0, Math.floor(maxSize));
  if (limit <= 0) {
    map.clear();
    return;
  }

  while (map.size > limit) {
    // Map iteration is insertion ordered; deleting the first key preserves the newest tracked
    // entries for request/memory guard caches.
    const oldest = map.keys().next();
    if (oldest.done) {
      break;
    }
    map.delete(oldest.value);
  }
}

/** Prunes a Set in insertion order until it fits the requested maximum size. */
export function pruneSetToMaxSize<T>(set: Set<T>, maxSize: number): void {
  if (Number.isNaN(maxSize) || maxSize === Number.POSITIVE_INFINITY) {
    // Treat "unknown" or unlimited sizes as no-op so callers can wire optional caps directly.
    return;
  }
  const limit = Math.max(0, Math.floor(maxSize));
  if (limit <= 0) {
    set.clear();
    return;
  }

  while (set.size > limit) {
    // Set iteration is insertion ordered; deleting the first value preserves the newest tracked
    // entries for request/memory guard caches.
    const oldest = set.values().next();
    if (oldest.done) {
      break;
    }
    set.delete(oldest.value);
  }
}

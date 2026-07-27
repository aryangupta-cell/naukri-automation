/**
 * Resolves `key` from `cache` if present, otherwise computes it via
 * `resolve` and stores it. Used to search each distinct mobile number once
 * per run and reuse the result for duplicate rows (spec 7.1).
 */
export async function resolveWithCache<K, V>(
  cache: Map<K, V>,
  key: K,
  resolve: (key: K) => Promise<V>,
): Promise<{ value: V; fromCache: boolean }> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return { value: cached, fromCache: true };
  }
  const value = await resolve(key);
  cache.set(key, value);
  return { value, fromCache: false };
}

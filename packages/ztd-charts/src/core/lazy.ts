/**
 * An array with a fixed length whose items are created on first read. Used to avoid building all of 10,000 labels and events.
 * Supports index reads, length, slice, map, forEach and indexOf (without a has trap, array methods skip empty slots).
 */
export function lazyArray<T>(n: number, make: (i: number) => T): T[] {
  const cache = new Array<T | undefined>(n);
  const has = new Uint8Array(n);
  const index = (prop: string | symbol): number => {
    if (typeof prop !== "string" || prop.length === 0 || prop.length > 9) return -1;
    const i = Number(prop);
    return Number.isInteger(i) && i >= 0 && i < n && String(i) === prop ? i : -1;
  };
  return new Proxy(cache as T[], {
    get(target, prop, recv) {
      const i = index(prop);
      if (i >= 0) {
        if (!has[i]) {
          target[i] = make(i);
          has[i] = 1;
        }
        return target[i];
      }
      return Reflect.get(target, prop, recv);
    },
    has(target, prop) {
      return index(prop) >= 0 || Reflect.has(target, prop);
    },
  });
}

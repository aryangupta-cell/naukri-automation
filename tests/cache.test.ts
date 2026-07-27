import { describe, expect, it, vi } from "vitest";
import { resolveWithCache } from "../src/utils/cache.js";

describe("resolveWithCache", () => {
  it("calls the resolver on the first lookup and caches the result", async () => {
    const cache = new Map<string, string>();
    const resolve = vi.fn(async (key: string) => `result-for-${key}`);

    const first = await resolveWithCache(cache, "9910926444", resolve);
    expect(first).toEqual({ value: "result-for-9910926444", fromCache: false });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("reuses the cached result for a duplicate mobile number without calling the resolver again", async () => {
    const cache = new Map<string, string>();
    const resolve = vi.fn(async (key: string) => `result-for-${key}`);

    await resolveWithCache(cache, "9910926444", resolve);
    const second = await resolveWithCache(cache, "9910926444", resolve);

    expect(second).toEqual({ value: "result-for-9910926444", fromCache: true });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("resolves distinct keys independently", async () => {
    const cache = new Map<string, string>();
    const resolve = vi.fn(async (key: string) => `result-for-${key}`);

    await resolveWithCache(cache, "9910926444", resolve);
    await resolveWithCache(cache, "8946908503", resolve);

    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

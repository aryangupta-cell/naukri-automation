import { describe, expect, it } from "vitest";
import { normalizeMobile } from "../src/domain/mobile.js";
import { maskMobile } from "../src/utils/mask.js";

describe("normalizeMobile", () => {
  it("accepts a plain 10-digit number", () => {
    expect(normalizeMobile("9910926444")).toEqual({ valid: true, digits10: "9910926444" });
  });

  it("strips spreadsheet-numeric trailing .0", () => {
    expect(normalizeMobile("9910926444.0")).toEqual({ valid: true, digits10: "9910926444" });
  });

  it("strips spaces, hyphens and parentheses", () => {
    expect(normalizeMobile("(991) 092-6444")).toEqual({ valid: true, digits10: "9910926444" });
  });

  it("strips a leading +91", () => {
    expect(normalizeMobile("+919910926444")).toEqual({ valid: true, digits10: "9910926444" });
  });

  it("strips a leading 91 when the total length is 12", () => {
    expect(normalizeMobile("919910926444")).toEqual({ valid: true, digits10: "9910926444" });
  });

  it("rejects empty input", () => {
    expect(normalizeMobile("").valid).toBe(false);
    expect(normalizeMobile(null).valid).toBe(false);
    expect(normalizeMobile(undefined).valid).toBe(false);
  });

  it("rejects non-numeric input", () => {
    expect(normalizeMobile("abcdefghij").valid).toBe(false);
  });

  it("rejects the wrong digit count", () => {
    expect(normalizeMobile("12345").valid).toBe(false);
    expect(normalizeMobile("12345678901234").valid).toBe(false);
  });
});

describe("maskMobile", () => {
  it("keeps only the last 4 digits visible", () => {
    expect(maskMobile("9910926444")).toBe("******6444");
  });

  it("masks fully when shorter than 4 digits", () => {
    expect(maskMobile("12")).toBe("**");
  });
});

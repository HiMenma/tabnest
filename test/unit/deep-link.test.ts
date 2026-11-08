import { describe, expect, it } from "vitest";
import { parseGroupParam } from "../../src/ui/data/deep-link";

describe("parseGroupParam", () => {
  it("reads a group id", () => {
    expect(parseGroupParam("?group=abc-123")).toBe("abc-123");
    expect(parseGroupParam("?foo=1&group=abc")).toBe("abc");
  });

  it("returns null when absent or empty", () => {
    expect(parseGroupParam("")).toBeNull();
    expect(parseGroupParam("?group=")).toBeNull();
    expect(parseGroupParam("?group=%20%20")).toBeNull();
    expect(parseGroupParam("?other=1")).toBeNull();
  });

  it("trims and decodes", () => {
    expect(parseGroupParam("?group=%20abc%20")).toBe("abc");
  });
});

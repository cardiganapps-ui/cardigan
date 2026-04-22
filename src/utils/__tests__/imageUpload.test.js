import { describe, it, expect } from "vitest";
import { avatarPath } from "../imageUpload.js";

/* The resize pipeline itself relies on DOM APIs (Image, Canvas,
   URL.createObjectURL) that aren't available in vitest's default
   node environment. We unit-test the pure helpers here and cover
   the pipeline behavior via manual browser verification (see the
   plan file's verification section). */

describe("avatarPath", () => {
  it("builds a path prefixed with the user id", () => {
    const p = avatarPath("user-abc", 1234567890);
    expect(p).toBe("user-abc/profile/avatar-1234567890.jpg");
  });

  it("uses Date.now() by default and includes the profile segment", () => {
    const p = avatarPath("u1");
    expect(p.startsWith("u1/profile/avatar-")).toBe(true);
    expect(p.endsWith(".jpg")).toBe(true);
  });

  it("throws without a userId", () => {
    expect(() => avatarPath(null)).toThrow();
    expect(() => avatarPath("")).toThrow();
  });
});

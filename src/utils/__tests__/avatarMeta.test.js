import { describe, it, expect } from "vitest";
import { resolveAvatar } from "../avatarMeta.js";

/* Covers the pure metadata-resolution logic. The network-backed
   presigned-URL path is exercised by manual browser verification. */

describe("resolveAvatar", () => {
  it("returns kind:null for missing or malformed metadata", () => {
    expect(resolveAvatar(null)).toEqual({ kind: null });
    expect(resolveAvatar(undefined)).toEqual({ kind: null });
    expect(resolveAvatar("nope")).toEqual({ kind: null });
    expect(resolveAvatar({})).toEqual({ kind: null });
    expect(resolveAvatar({ kind: "uploaded" })).toEqual({ kind: null });
  });

  it("returns the raw path for uploaded avatars", () => {
    const out = resolveAvatar({ kind: "uploaded", value: "u1/profile/avatar-123.jpg" });
    expect(out).toEqual({ kind: "uploaded", path: "u1/profile/avatar-123.jpg" });
  });

  it("ignores legacy preset metadata (gallery was removed)", () => {
    expect(resolveAvatar({ kind: "preset", value: "preset:sprig-01" })).toEqual({ kind: null });
  });

  it("ignores unknown kinds", () => {
    expect(resolveAvatar({ kind: "weird", value: "x" })).toEqual({ kind: null });
  });
});

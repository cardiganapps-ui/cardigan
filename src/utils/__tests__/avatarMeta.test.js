import { describe, it, expect } from "vitest";
import { resolveAvatar } from "../avatarMeta.js";

/* Covers the pure metadata-resolution logic. The network-backed
   presigned-URL path is exercised by manual browser verification
   (see the plan file). */

describe("resolveAvatar", () => {
  it("returns kind:null for missing or malformed metadata", () => {
    expect(resolveAvatar(null)).toEqual({ kind: null });
    expect(resolveAvatar(undefined)).toEqual({ kind: null });
    expect(resolveAvatar("nope")).toEqual({ kind: null });
    expect(resolveAvatar({})).toEqual({ kind: null });
    expect(resolveAvatar({ kind: "preset" })).toEqual({ kind: null });
    expect(resolveAvatar({ kind: "uploaded" })).toEqual({ kind: null });
  });

  it("resolves a preset with the `preset:` prefix", () => {
    const out = resolveAvatar({ kind: "preset", value: "preset:sprig-01" });
    expect(out).toEqual({ kind: "preset", presetId: "sprig-01" });
  });

  it("resolves a preset without the prefix (backwards-compat)", () => {
    const out = resolveAvatar({ kind: "preset", value: "flower-01" });
    expect(out).toEqual({ kind: "preset", presetId: "flower-01" });
  });

  it("returns the raw path for uploaded avatars (URL is resolved async elsewhere)", () => {
    const out = resolveAvatar({ kind: "uploaded", value: "u1/profile/avatar-123.jpg" });
    expect(out).toEqual({ kind: "uploaded", path: "u1/profile/avatar-123.jpg" });
  });

  it("ignores unknown kinds", () => {
    expect(resolveAvatar({ kind: "weird", value: "x" })).toEqual({ kind: null });
  });
});

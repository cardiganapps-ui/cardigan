/* ── R2 path-authorization tests ──
   validatePath is the boundary that keeps one therapist from reading or
   deleting another's documents, avatars, receipts, and note attachments.
   It is the last line of defence on every presigned-URL endpoint
   (upload-url, document-url, delete-document, note-attachment-url), so
   its traversal/prefix rules get pinned here as a pure unit. A regression
   that loosens this is a cross-tenant data-leak class bug. */

import { describe, it, expect } from "vitest";
import { validatePath } from "../_r2.js";

const USER = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";

describe("validatePath — accepted shapes", () => {
  it("accepts the `<userId>/...` document/avatar/receipt prefix", () => {
    expect(validatePath(`${USER}/avatar.png`, USER)).toBe(true);
    expect(validatePath(`${USER}/docs/receipt-2026-05.pdf`, USER)).toBe(true);
  });

  it("accepts the `notes/<userId>/...` note-attachment prefix", () => {
    expect(
      validatePath(`notes/${USER}/note-abc/aaaa-bbbb.jpg`, USER)
    ).toBe(true);
  });
});

describe("validatePath — cross-tenant isolation", () => {
  it("rejects another user's document folder", () => {
    expect(validatePath(`${OTHER}/avatar.png`, USER)).toBe(false);
  });

  it("rejects another user's note-attachment folder", () => {
    expect(validatePath(`notes/${OTHER}/note-abc/x.jpg`, USER)).toBe(false);
  });

  it("rejects a userId that is only a prefix of another (no fake match on substring)", () => {
    // `${USER}extra/...` must NOT pass just because it starts with USER —
    // the trailing slash is mandatory.
    expect(validatePath(`${USER}extra/file.png`, USER)).toBe(false);
  });
});

describe("validatePath — traversal & malformed input", () => {
  it("rejects `..` traversal even under the user's own prefix", () => {
    expect(validatePath(`${USER}/../${OTHER}/secret.pdf`, USER)).toBe(false);
    expect(validatePath(`notes/${USER}/../../etc/passwd`, USER)).toBe(false);
  });

  it("rejects empty `//` segments", () => {
    expect(validatePath(`${USER}//double.png`, USER)).toBe(false);
  });

  it("rejects a bare userId with no trailing slash", () => {
    expect(validatePath(USER, USER)).toBe(false);
  });

  it("rejects null / undefined / non-string / empty input", () => {
    expect(validatePath(null, USER)).toBe(false);
    expect(validatePath(undefined, USER)).toBe(false);
    expect(validatePath("", USER)).toBe(false);
    expect(validatePath(42, USER)).toBe(false);
    expect(validatePath({}, USER)).toBe(false);
  });

  it("rejects absurdly long paths (>512 chars) to bound key abuse", () => {
    const long = `${USER}/` + "a".repeat(600);
    expect(validatePath(long, USER)).toBe(false);
  });

  it("accepts a path exactly at the 512-char limit", () => {
    const prefix = `${USER}/`;
    const path = prefix + "a".repeat(512 - prefix.length);
    expect(path.length).toBe(512);
    expect(validatePath(path, USER)).toBe(true);
  });
});

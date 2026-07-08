import { describe, it, expect } from "vitest";
// Co-located with the CI script so it lives outside tsconfig's `src`
// include (no allowJs friction) while vitest's default glob still runs
// it. Importing the module does NOT hit the network — the ASC fetch path
// is guarded behind a direct-invocation check.
import { resolveVersion, bumpLast, cmpVersion } from "./resolve-ios-version.mjs";

const F = { fallback: "20.7" };

describe("iOS marketing-version resolver", () => {
  it("bumpLast increments the last numeric segment", () => {
    expect(bumpLast("20.6")).toBe("20.7");
    expect(bumpLast("20.9")).toBe("20.10");
    expect(bumpLast("20.6.1")).toBe("20.6.2");
  });

  it("cmpVersion compares numerically, not lexically", () => {
    expect(cmpVersion("20.10", "20.9")).toBeGreaterThan(0);
    expect(cmpVersion("20.6", "20.6")).toBe(0);
    expect(cmpVersion("20.6", "20.7")).toBeLessThan(0);
  });

  it("bumps past the highest released version when there's no draft", () => {
    // Today's real state: 20.6 released, no open draft → 20.7.
    expect(resolveVersion([
      { versionString: "20.6", state: "READY_FOR_SALE" },
      { versionString: "20.5", state: "REPLACED_WITH_NEW_VERSION" },
    ], F)).toBe("20.7");
  });

  it("reuses an open draft that matches the bumped value", () => {
    expect(resolveVersion([
      { versionString: "20.6", state: "READY_FOR_SALE" },
      { versionString: "20.7", state: "PREPARE_FOR_SUBMISSION" },
    ], F)).toBe("20.7");
  });

  it("advances exactly once per release", () => {
    expect(resolveVersion([
      { versionString: "20.6", state: "REPLACED_WITH_NEW_VERSION" },
      { versionString: "20.7", state: "READY_FOR_SALE" },
    ], F)).toBe("20.8");
  });

  it("reuses open review states, bumps past pending-release", () => {
    expect(resolveVersion([
      { versionString: "20.6", state: "READY_FOR_SALE" },
      { versionString: "20.7", state: "IN_REVIEW" },
    ], F)).toBe("20.7");
    expect(resolveVersion([
      { versionString: "20.7", state: "PENDING_DEVELOPER_RELEASE" },
    ], F)).toBe("20.8");
  });

  it("reuses a draft that is already ahead of the bump", () => {
    expect(resolveVersion([
      { versionString: "20.8", state: "READY_FOR_SALE" },
      { versionString: "20.10", state: "PREPARE_FOR_SUBMISSION" },
    ], F)).toBe("20.10");
  });

  it("falls back / floors safely on empty or junk input", () => {
    expect(resolveVersion([], F)).toBe("20.7");
    expect(resolveVersion([{ versionString: "20.2", state: "READY_FOR_SALE" }], F)).toBe("20.7");
    expect(resolveVersion([
      { versionString: "not-a-version", state: "READY_FOR_SALE" },
      { versionString: "20.6", state: "READY_FOR_SALE" },
    ], F)).toBe("20.7");
  });
});

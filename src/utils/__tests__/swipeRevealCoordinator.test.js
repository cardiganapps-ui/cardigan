import { describe, it, expect, beforeEach, vi } from "vitest";
import { claim, release, closeOpen, isOpen, __resetForTests } from "../../hooks/swipeRevealCoordinator";

beforeEach(() => __resetForTests());

describe("swipeRevealCoordinator", () => {
  it("registers the first claim", () => {
    const close = vi.fn();
    claim("a", close);
    expect(isOpen()).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });

  it("calls the previous owner's closeFn when a new row claims", () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    claim("a", closeA);
    claim("b", closeB);
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).not.toHaveBeenCalled();
    expect(isOpen()).toBe(true);
  });

  it("does not re-fire the same row's closeFn on repeat claim", () => {
    const closeA = vi.fn();
    claim("a", closeA);
    claim("a", closeA);
    expect(closeA).not.toHaveBeenCalled();
  });

  it("release clears the owner only when ids match", () => {
    const closeA = vi.fn();
    claim("a", closeA);
    release("b");
    expect(isOpen()).toBe(true);
    release("a");
    expect(isOpen()).toBe(false);
  });

  it("closeOpen invokes the registered closeFn and clears state", () => {
    const close = vi.fn();
    claim("a", close);
    closeOpen();
    expect(close).toHaveBeenCalledTimes(1);
    expect(isOpen()).toBe(false);
  });

  it("closeOpen is a no-op when nothing is registered", () => {
    expect(() => closeOpen()).not.toThrow();
    expect(isOpen()).toBe(false);
  });
});

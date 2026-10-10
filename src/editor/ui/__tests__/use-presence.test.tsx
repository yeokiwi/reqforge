// @vitest-environment jsdom
// Presence (RD-062): a heartbeat at once and every 15 s while mounted, nothing after unmount;
// only OTHER users are shown; a brief outage does not blank the avatars.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRef } from "@/domain/documents/api-types";
import { othersOf, usePresence } from "../use-presence";

const ME = { id: "me", name: "Me" };
const BOB = { id: "bob", name: "Bob Builder" };
const CAROL = { id: "carol", name: "Carol" };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("othersOf", () => {
  it("leaves out the caller and duplicates, keeping the server's order", () => {
    expect(othersOf([CAROL, ME, BOB, CAROL], ME.id)).toEqual([CAROL, BOB]);
    expect(othersOf([], ME.id)).toEqual([]);
  });
});

describe("usePresence", () => {
  it("beats at once and every 15 s, and shows the others", async () => {
    let users: UserRef[] = [ME, BOB];
    const heartbeat = vi.fn(async () => users);
    const { result } = renderHook(() => usePresence(heartbeat, ME.id));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual([BOB]);
    users = [CAROL, ME];
    await act(() => vi.advanceTimersByTimeAsync(14_999));
    expect(heartbeat).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(heartbeat).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual([CAROL]);
  });

  it("stops beating and aborts the request in flight on unmount", async () => {
    const signals: AbortSignal[] = [];
    const heartbeat = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<UserRef[]>(() => undefined);
    });
    const { unmount } = renderHook(() => usePresence(heartbeat, ME.id));
    expect(heartbeat).toHaveBeenCalledTimes(1);
    unmount();
    expect(signals[0]?.aborted).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it("keeps the last list through a failed beat, and clears it once older than the 45 s window", async () => {
    let clock = 0;
    let fail = false;
    const heartbeat = vi.fn(async () => {
      if (fail) throw new Error("offline");
      return [BOB];
    });
    const { result } = renderHook(() => usePresence(heartbeat, ME.id, { now: () => clock }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current).toEqual([BOB]);
    fail = true;
    clock = 30_000;
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(result.current).toEqual([BOB]);
    clock = 46_000;
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(result.current).toEqual([]);
  });

  it("keeps the same array when nothing changed, so the editor does not re-render for nothing", async () => {
    const heartbeat = vi.fn(async () => [{ ...BOB }]);
    const { result } = renderHook(() => usePresence(heartbeat, ME.id));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const first = result.current;
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(result.current).toBe(first);
  });
});

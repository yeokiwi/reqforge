import { describe, expect, it } from "vitest";
import { LoginThrottle } from "@/domain/auth/login-throttle";

function setup(options: { maxFailures?: number; windowMs?: number; maxKeys?: number } = {}) {
  const clock = { now: 1_000_000 };
  const throttle = new LoginThrottle({
    maxFailures: 3,
    windowMs: 60_000,
    now: () => clock.now,
    ...options,
  });
  return { clock, throttle };
}

describe("LoginThrottle", () => {
  it("allows attempts until the failure budget is spent", () => {
    const { throttle } = setup();
    throttle.recordFailure("a@x.test");
    throttle.recordFailure("a@x.test");
    expect(throttle.retryAfterSeconds("a@x.test")).toBe(0);
    throttle.recordFailure("a@x.test");
    expect(throttle.retryAfterSeconds("a@x.test")).toBeGreaterThan(0);
  });

  it("reports when the oldest failure leaves the window", () => {
    const { throttle, clock } = setup();
    throttle.recordFailure("k");
    clock.now += 10_000;
    throttle.recordFailure("k");
    throttle.recordFailure("k");
    expect(throttle.retryAfterSeconds("k")).toBe(50);
  });

  it("recovers once failures age out", () => {
    const { throttle, clock } = setup();
    for (let i = 0; i < 3; i++) throttle.recordFailure("k");
    clock.now += 60_001;
    expect(throttle.retryAfterSeconds("k")).toBe(0);
  });

  it("tracks keys independently", () => {
    const { throttle } = setup();
    for (let i = 0; i < 3; i++) throttle.recordFailure("a");
    expect(throttle.retryAfterSeconds("a")).toBeGreaterThan(0);
    expect(throttle.retryAfterSeconds("b")).toBe(0);
  });

  it("reset clears a key after a successful sign-in", () => {
    const { throttle } = setup();
    for (let i = 0; i < 3; i++) throttle.recordFailure("k");
    throttle.reset("k");
    expect(throttle.retryAfterSeconds("k")).toBe(0);
  });

  it("bounds memory by evicting the least recently failed key", () => {
    const { throttle } = setup({ maxKeys: 2 });
    for (let i = 0; i < 3; i++) throttle.recordFailure("old");
    throttle.recordFailure("b");
    throttle.recordFailure("c");
    expect(throttle.retryAfterSeconds("old")).toBe(0); // evicted
  });

  it("never reports a retry of less than one second while blocked", () => {
    const { throttle, clock } = setup();
    for (let i = 0; i < 3; i++) throttle.recordFailure("k");
    clock.now += 59_999;
    expect(throttle.retryAfterSeconds("k")).toBe(1);
  });
});

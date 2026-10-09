import { LoginThrottle } from "@/domain/auth/login-throttle";

// One throttle per server process, kept on globalThis so Next's dev-mode module reloads do
// not reset it. Keyed by email: this stops guessing against one account but also lets
// someone lock a known address out for the window — acceptable for slice 0, and the
// interface lets a shared store replace it later.
const globalForThrottle = globalThis as unknown as { __reqforgeLoginThrottle?: LoginThrottle };

export const loginThrottle = (globalForThrottle.__reqforgeLoginThrottle ??= new LoginThrottle());

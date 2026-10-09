import { expect } from "vitest";

// Minimal DOM assertions so component tests read well without another dependency.
expect.extend({
  toHaveAttribute(received: Element, name: string, value?: string) {
    const actual = received.getAttribute(name);
    const pass = value === undefined ? actual !== null : actual === value;
    return {
      pass,
      message: () =>
        `expected <${received.tagName.toLowerCase()}> ${pass ? "not " : ""}to have attribute ${name}${
          value === undefined ? "" : `="${value}"`
        } (actual: ${actual === null ? "absent" : `"${actual}"`})`,
    };
  },
  toHaveValue(received: HTMLInputElement, value: string) {
    return {
      pass: received.value === value,
      message: () => `expected input value ${JSON.stringify(received.value)} to be ${JSON.stringify(value)}`,
    };
  },
  toHaveTextContent(received: Element, text: string) {
    return {
      pass: (received.textContent ?? "").includes(text),
      message: () => `expected text ${JSON.stringify(received.textContent)} to include ${JSON.stringify(text)}`,
    };
  },
});

declare module "vitest" {
  interface Assertion<T> {
    toHaveAttribute(name: string, value?: string): T;
    toHaveValue(value: string): T;
    toHaveTextContent(text: string): T;
  }
  interface AsymmetricMatchersContaining {
    toHaveAttribute(name: string, value?: string): unknown;
  }
}

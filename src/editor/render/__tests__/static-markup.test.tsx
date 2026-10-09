/* eslint-disable @next/next/no-img-element -- markup fixtures, compared as strings */
// renderStaticMarkup against react-dom's renderToStaticMarkup, beyond what DocumentView emits
// (document-view.test.tsx covers that, byte for byte): React's attribute rules for the
// markup a custom node renderer might return, and refusals for what it does not reproduce.
import { Component, type CSSProperties, Suspense, createContext, createElement, lazy, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/domain/errors";
import { renderStaticMarkup } from "../static-markup";

const STYLE = {
  width: 10,
  lineHeight: 1.5,
  margin: 0,
  flexGrow: 2,
  WebkitLineClamp: 3,
  msTransform: "none",
  "--rf-x": " y ",
  color: "",
  top: null,
} as unknown as CSSProperties;

function Pill({ label, children }: { label: string; children?: ReactNode }): ReactNode {
  return (
    <span className="pill" data-label={label}>
      {children}
    </span>
  );
}

describe("renderStaticMarkup — the same markup as react-dom", () => {
  // React logs warnings for some of these (true on a non-boolean attribute, …); the output is
  // what matters here.
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => undefined);

  it.each<[string, ReactNode]>([
    ["text, numbers and bigints, escaped", <p key="k">{["a<b>&\"c'", 1, 2.5, BigInt(3), null, undefined, true, false]}</p>],
    ["nested arrays and fragments", <div key="k">{[["a", ["b"]], <>c{"d"}</>]}</div>],
    ["function components with children", <Pill key="k" label="BR-01">{<em>x</em>}</Pill>],
    ["aliases", <label key="k" className="c" htmlFor="i" tabIndex={0} />],
    ["booleans", <details key="k" open hidden={false} />],
    ["lower-cased booleans", <video key="k" autoPlay muted={false} />],
    ["booleans React writes as text", <li key="k" contentEditable={false} spellCheck draggable value={3} />],
    ["true and false on data- and aria- attributes, dropped elsewhere", <div key="k" data-x data-y={false} aria-hidden title={true as unknown as string} />],
    ["styles: px, unitless, zero, custom properties, vendor prefixes", <div key="k" style={STYLE} />],
    ["an empty style", <div key="k" style={{}} />],
    ["rowSpan, start and span", <table key="k"><colgroup><col span={2} /><col span={0} /></colgroup><tbody><tr><td rowSpan={2} colSpan={3} /></tr></tbody></table>],
    ["an ordered list start", <ol key="k" start={0} />],
    ["an empty href on <a>, an empty src elsewhere", <a key="k" href=""><img src="" alt="" loading="lazy" /></a>],
    ["void elements", <p key="k"><br /><hr /><wbr /></p>],
    ["<pre> with a leading newline", <pre key="k">{"\nline"}</pre>],
    ["<input>: name, checked and value after the rest", <input key="k" type="checkbox" name="n" checked readOnly value="v" id="i" disabled />],
    ["<input>: defaultChecked and defaultValue", <input key="k" type="text" defaultChecked defaultValue="d" />],
    ["<input>: checked false", <input key="k" type="checkbox" checked={false} readOnly />],
    ["event handlers dropped", <span key="k" onClick={() => undefined} onMouseOver={() => undefined} />],
    ["key and ref dropped", <span key="k" ref={null} />],
  ])("%s", (_label, node) => {
    const spy = quiet();
    try {
      expect(renderStaticMarkup(node)).toBe(renderToStaticMarkup(node));
    } finally {
      spy.mockRestore();
    }
  });
});

describe("renderStaticMarkup — what it never writes", () => {
  it("drops a javascript: URL where React would write its own blocking URL", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(renderStaticMarkup(<a href="javascript:alert(1)">x</a>)).toBe("<a>x</a>");
      expect(renderStaticMarkup(<a href={" \tjava\nscript:alert(1)"}>x</a>)).toBe("<a>x</a>");
      expect(renderStaticMarkup(<img src="JAVASCRIPT:alert(1)" alt="" loading="lazy" />)).toBe('<img alt="" loading="lazy"/>');
    } finally {
      spy.mockRestore();
    }
  });

  it("writes no resource hints", () => {
    expect(renderStaticMarkup(<img src="/x.png" alt="" />)).toBe('<img src="/x.png" alt=""/>');
  });
});

describe("renderStaticMarkup — refuses what it does not reproduce", () => {
  class Legacy extends Component {
    override render(): ReactNode {
      return "x";
    }
  }
  const Context = createContext("x");
  const Lazy = lazy(async () => ({ default: () => "x" }));
  async function Async(): Promise<ReactNode> {
    return "x";
  }

  it.each<[string, () => ReactNode]>([
    ["dangerouslySetInnerHTML", () => <div {...{ ["dangerously" + "SetInnerHTML"]: { __html: "<b>x</b>" } }} />],
    ["a <script>", () => <script>alert(1)</script>],
    ["a <style>", () => <style>{"p{}"}</style>],
    ["an <svg>", () => <svg />],
    ["a <textarea>", () => <textarea defaultValue="x" />],
    ["a <form>", () => <form />],
    ["a custom element", () => createElement("x-pill")],
    ["children in a void element", () => <br>{"x"}</br>],
    ["a class component", () => <Legacy />],
    ["a context provider", () => <Context.Provider value="y">x</Context.Provider>],
    ["Suspense", () => <Suspense>x</Suspense>],
    ["a lazy component", () => <Lazy />],
    ["an async component", () => createElement(Async as unknown as () => ReactNode)],
    ["a plain object as a child", () => <p>{{ a: 1 } as unknown as ReactNode}</p>],
    ["a formAction on an input", () => <input formAction="/x" />],
  ])("%s", (_label, build) => {
    let caught: unknown;
    try {
      renderStaticMarkup(build());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("RENDER_UNSUPPORTED");
  });
});

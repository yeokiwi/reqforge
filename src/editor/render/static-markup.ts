// Static HTML for a React element tree, without react-dom. `GET /pages/{id}?format=html` is a
// route handler, and Next bundles route handlers in the react-server layer, where every
// `react-dom/server` entry is a module that throws on import. DocumentView is static (no
// hooks, no context), so its tree can be serialised directly.
//
// The output is byte-identical to react-dom's renderToStaticMarkup for everything
// DocumentView emits; tests hold it to that. It follows React's attribute rules (names,
// booleans, styles, escaping) for the rest, and refuses with an AppError what it does not
// reproduce rather than guess: class components, context, Suspense, lazy, portals, raw HTML
// (dangerouslySetInnerHTML), and elements whose content is not plain HTML (script, style,
// form controls with values, svg, …). It never emits an event handler or a javascript: URL,
// and never a resource hint (React 19 prepends `<link rel="preload">` for an image that is
// not `loading="lazy"`; DocumentView's images always are).
// spec: docs/specs/08-api-surface.md section 3 (?format=html)
import { Fragment, type ReactNode, isValidElement } from "react";
import { AppError } from "@/domain/errors";

const UNSUPPORTED = "RENDER_UNSUPPORTED";

const VOID_ELEMENTS = new Set(["area", "br", "col", "embed", "hr", "img", "input", "source", "track", "wbr"]);

/**
 * Elements React gives special treatment that this serialiser does not reproduce: document
 * and head elements (hoisted by React 19), raw-text elements, forms and form controls whose
 * value becomes content or whose action React encodes, and foreign content with its own
 * attribute namespace.
 */
const REFUSED_ELEMENTS = new Set([
  "base",
  "body",
  "button",
  "form",
  "head",
  "html",
  "iframe",
  "link",
  "math",
  "meta",
  "noscript",
  "object",
  "option",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
  "title",
]);

// Lower-case HTML element names only: custom elements (with a hyphen) take React's
// custom-element attribute rules, which are not reproduced here.
const TAG = /^[a-z][a-z0-9]*$/;

// React's VALID_ATTRIBUTE_NAME_REGEX (react-dom-server).
const ATTRIBUTE_NAME =
  /^[:A-Z_a-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�][:A-Z_a-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�\-.0-9·̀-ͯ‿-⁀]*$/;

/** Boolean attributes: present and empty when truthy, absent otherwise (React's list). */
const BOOLEAN_ATTRIBUTES = new Set([
  "allowFullScreen",
  "async",
  "autoPlay",
  "controls",
  "default",
  "defer",
  "disabled",
  "disablePictureInPicture",
  "disableRemotePlayback",
  "formNoValidate",
  "hidden",
  "inert",
  "loop",
  "noModule",
  "noValidate",
  "open",
  "playsInline",
  "readOnly",
  "required",
  "reversed",
  "scoped",
  "seamless",
  "itemScope",
]);

/** Booleans React writes lower-cased. */
const LOWER_CASE_BOOLEANS = new Set(["autoFocus", "multiple", "muted"]);

/** Attributes React writes as "true" or "false" when given a boolean. */
const STRINGIFIED_BOOLEANS = new Set(["contentEditable", "spellCheck", "draggable", "value"]);

/** Props React drops. */
const DROPPED = new Set(["children", "defaultValue", "defaultChecked", "innerHTML", "suppressContentEditableWarning", "suppressHydrationWarning", "ref"]);

const ALIASES: Readonly<Record<string, string>> = {
  className: "class",
  tabIndex: "tabindex",
  htmlFor: "for",
  acceptCharset: "accept-charset",
  httpEquiv: "http-equiv",
  crossOrigin: "crossorigin",
};

const URL_ATTRIBUTES = new Set(["src", "href", "action", "formAction"]);

// React's isJavaScriptProtocol: leading C0 controls and spaces, tabs and newlines anywhere.
const JAVASCRIPT_URL =
  /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;

// React's isUnitlessNumber list: numbers for these style properties get no `px`.
const UNITLESS = new Set(
  (
    "animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup " +
    "boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow " +
    "gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp " +
    "lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity " +
    "strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex " +
    "MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder " +
    "msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount " +
    "WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow " +
    "WebkitFlexPositive WebkitFlexShrink WebkitLineClamp"
  ).split(" "),
);

const ESCAPES: Readonly<Record<string, string>> = { '"': "&quot;", "&": "&amp;", "'": "&#x27;", "<": "&lt;", ">": "&gt;" };

/** React's escapeTextForBrowser: the same five characters, the same entities. */
function escape(value: unknown): string {
  return String(value).replace(/["&'<>]/g, (c) => ESCAPES[c] ?? c);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unsupported(what: string): AppError {
  return new AppError(UNSUPPORTED, `renderStaticMarkup cannot render ${what}`);
}

function hyphenate(name: string): string {
  return name.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^ms-/, "-ms-");
}

function styleAttribute(style: unknown): string {
  if (!isRecord(style) || Array.isArray(style)) throw unsupported("a style that is not an object");
  const parts: string[] = [];
  for (const [name, value] of Object.entries(style)) {
    if (value === null || value === undefined || typeof value === "boolean" || value === "") continue;
    if (name.startsWith("--")) {
      parts.push(`${escape(name)}:${escape(String(value).trim())}`);
    } else if (typeof value === "number") {
      parts.push(`${escape(hyphenate(name))}:${value === 0 || UNITLESS.has(name) ? String(value) : `${value}px`}`);
    } else {
      parts.push(`${escape(hyphenate(name))}:${escape(String(value).trim())}`);
    }
  }
  return parts.length > 0 ? ` style="${parts.join(";")}"` : "";
}

/** One attribute as React writes it, or "" when React would drop it. */
function attribute(tag: string, name: string, value: unknown): string {
  if (value === null || value === undefined || DROPPED.has(name)) return "";
  if (typeof value === "function" || typeof value === "symbol") return "";
  if (name === "dangerouslySetInnerHTML") throw unsupported("dangerouslySetInnerHTML");
  if (name === "style") return styleAttribute(value);
  if (BOOLEAN_ATTRIBUTES.has(name)) return value ? ` ${name}=""` : "";
  if (LOWER_CASE_BOOLEANS.has(name)) return value ? ` ${name.toLowerCase()}=""` : "";
  if (URL_ATTRIBUTES.has(name)) {
    if (typeof value === "boolean") return "";
    if (value === "") return tag === "a" && name === "href" ? ' href=""' : "";
    const url = String(value);
    return JAVASCRIPT_URL.test(url) ? "" : ` ${name}="${escape(url)}"`;
  }
  if (name === "rowSpan" || name === "start") return Number.isNaN(Number(value)) ? "" : ` ${name}="${escape(value)}"`;
  if (name === "cols" || name === "rows" || name === "size" || name === "span") {
    return !Number.isNaN(Number(value)) && Number(value) >= 1 ? ` ${name}="${escape(value)}"` : "";
  }
  if (STRINGIFIED_BOOLEANS.has(name)) return ` ${name}="${escape(value)}"`;
  if (name.length > 2 && (name[0] === "o" || name[0] === "O") && (name[1] === "n" || name[1] === "N")) return ""; // event handlers
  const html = ALIASES[name] ?? name;
  if (!ATTRIBUTE_NAME.test(html)) return "";
  if (typeof value === "boolean") {
    const prefix = html.toLowerCase().slice(0, 5);
    if (prefix !== "data-" && prefix !== "aria-") return "";
  }
  return ` ${html}="${escape(value)}"`;
}

function isWritable(value: unknown): boolean {
  return value !== null && value !== undefined && typeof value !== "function" && typeof value !== "symbol";
}

/** An `<input>`'s attributes: React writes `name`, then `checked`, then `value` after the rest. */
function inputAttributes(props: Record<string, unknown>): string {
  let out = "";
  for (const [name, value] of Object.entries(props)) {
    if (name === "formAction" || name === "formEncType" || name === "formMethod" || name === "formTarget") {
      if (value !== null && value !== undefined) throw unsupported(`${name} on <input>`);
    } else if (name !== "name" && name !== "checked" && name !== "value") {
      out += attribute("input", name, value);
    }
  }
  out += attribute("input", "name", props.name);
  const checked = props.checked ?? props.defaultChecked;
  if (checked && isWritable(checked)) out += ' checked=""';
  const value = props.value ?? props.defaultValue;
  if (isWritable(value)) out += ` value="${escape(value)}"`;
  return out;
}

function attributes(tag: string, props: Record<string, unknown>): string {
  if (tag === "input") return inputAttributes(props);
  let out = "";
  for (const [name, value] of Object.entries(props)) out += attribute(tag, name, value);
  return out;
}

function hostElement(tag: string, props: Record<string, unknown>, out: string[]): void {
  if (!TAG.test(tag) || REFUSED_ELEMENTS.has(tag)) throw unsupported(`the element <${tag.slice(0, 40)}>`);
  if (props.dangerouslySetInnerHTML !== undefined && props.dangerouslySetInnerHTML !== null) throw unsupported("dangerouslySetInnerHTML");
  const children = props.children;
  if (VOID_ELEMENTS.has(tag)) {
    if (children !== undefined && children !== null) throw unsupported(`children in the void element <${tag}>`);
    out.push(`<${tag}${attributes(tag, props)}/>`);
    return;
  }
  out.push(`<${tag}${attributes(tag, props)}>`);
  // The HTML parser drops a newline straight after <pre>, so React writes one more.
  if (tag === "pre" && typeof children === "string" && children.startsWith("\n")) out.push("\n");
  write(children, out);
  out.push(`</${tag}>`);
}

function write(node: unknown, out: string[]): void {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (typeof node === "string") {
    out.push(escape(node));
    return;
  }
  if (typeof node === "number" || typeof node === "bigint") {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) write(child, out);
    return;
  }
  if (!isValidElement(node)) throw unsupported(`a ${typeof node} as a child`);
  const props: Record<string, unknown> = isRecord(node.props) ? node.props : {};
  const type: unknown = node.type;
  if (typeof type === "string") hostElement(type, props, out);
  else if (type === Fragment) write(props.children, out);
  else if (typeof type === "function") {
    const prototype: unknown = type.prototype;
    if (isRecord(prototype) && "isReactComponent" in prototype) throw unsupported("a class component");
    const rendered: unknown = (type as (p: Record<string, unknown>) => unknown)(props);
    if (isRecord(rendered) && typeof rendered.then === "function") throw unsupported("an async component");
    write(rendered, out);
  } else throw unsupported("this element type");
}

/**
 * The static HTML of a React element tree, as react-dom's renderToStaticMarkup writes it,
 * for trees of host elements, fragments and plain function components.
 */
// spec: docs/specs/08-api-surface.md section 3 (?format=html)
export function renderStaticMarkup(node: ReactNode): string {
  const out: string[] = [];
  write(node, out);
  return out.join("");
}

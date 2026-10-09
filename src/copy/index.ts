// The copy-deck loader (docs/specs/10-ui-reference.md §13, RD-037). Components never inline
// user-facing strings; they call t("some.id"). Ids and placeholder names are type-checked,
// so a typo or a missing parameter is a compile error rather than a blank on screen.
import { AppError } from "@/domain/errors";
import { deck } from "./deck.generated";

export type Deck = typeof deck;
export type CopyId = keyof Deck;

type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | Placeholders<Rest>
  : never;

type CopyParams<I extends CopyId> = [Placeholders<Deck[I]>] extends [never]
  ? []
  : [params: Record<Placeholders<Deck[I]>, string | number>];

/** Ids whose strings have no `{placeholder}` — safe to pass around without parameters. */
export type ParamlessCopyId = {
  [K in CopyId]: [Placeholders<Deck[K]>] extends [never] ? K : never;
}[CopyId];

export class CopyError extends AppError {
  constructor(message: string) {
    super("COPY_DECK", message);
  }
}

export function isCopyId(id: string): id is CopyId {
  return Object.prototype.hasOwnProperty.call(deck, id);
}

/** Looks a string up by id and substitutes `{name}` placeholders. */
export function t<I extends CopyId>(id: I, ...args: CopyParams<I>): string {
  const template: string = deck[id];
  const params = (args[0] ?? {}) as Record<string, string | number>;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new CopyError(`copy "${id}" needs a "${name}" parameter`);
    return String(value);
  });
}

/** The product name, for the places that need it outside a sentence. */
export const APP_NAME = deck["app.name"];

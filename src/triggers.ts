import type { PromptTrigger, PromptTriggerItem } from "@particle-academy/react-fancy";

/** What a chosen item becomes in the message text: `[kind:target|label]`. */
export interface PillRef {
  kind: string;
  target: string;
  label: string;
}

export interface TriggerDefinition<T = PromptTriggerItem> {
  /** One character, e.g. `@ # / $ &` or a backtick. */
  char: string;
  label?: string;
  /** The pill kind a chosen item serialises to, e.g. `deal`. */
  kind: string;
  /** The app's source. Async is fine; a stale answer is dropped by PromptInput. */
  search: (query: string) => T[] | Promise<T[]>;
  /** Map one of the source's items to a picker row. Default: the item is already a row. */
  toItem?: (item: T) => PromptTriggerItem;
  /** The pill target for an item. Default: the row id. */
  toTarget?: (item: PromptTriggerItem) => string;
  wordStart?: boolean;
}

const PILL_KIND = /^[a-z][a-z0-9-]*$/;

/**
 * One line, with the grammar's own delimiters removed, so a label or target
 * can never close or split the pill it sits in.
 */
function pillField(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (ch === "[" || ch === "]" || ch === "|" || code < 0x20 || code === 0x7f) out += " ";
    else out += ch;
  }
  return out.trim();
}

/** `[kind:target|label]`, the pill grammar the markup policy resolves. */
export function serializePill(ref: PillRef): string {
  if (!PILL_KIND.test(ref.kind)) throw new TypeError(`A pill kind is lower case letters, digits and dashes: "${ref.kind}".`);
  const target = pillField(ref.target).replace(/:/g, " ");
  return `[${ref.kind}:${target}|${pillField(ref.label) || target}]`;
}

export interface TriggerRegistry {
  register<T>(definition: TriggerDefinition<T>): TriggerRegistry;
  /** The PromptInput `triggers` for these definitions. */
  triggers(): PromptTrigger[];
  chars(): string[];
}

/**
 * The app's trigger registry (MOIC: `@` prospect, `#` file, `/` prompt, `$`
 * deal, `&` op, a backtick for a skill). Each character gets a source and
 * serialises to the shared pill grammar; PromptInput's `triggers` does the
 * picking. One definition per character.
 */
export function createTriggerRegistry(definitions: TriggerDefinition<never>[] = []): TriggerRegistry {
  const byChar = new Map<string, TriggerDefinition<unknown>>();
  const registry: TriggerRegistry = {
    register(definition) {
      if ([...definition.char].length !== 1) throw new TypeError("A trigger is exactly one character.");
      if (byChar.has(definition.char)) throw new TypeError(`The trigger "${definition.char}" is already registered.`);
      if (!PILL_KIND.test(definition.kind)) throw new TypeError(`A pill kind is lower case letters, digits and dashes: "${definition.kind}".`);
      byChar.set(definition.char, definition as TriggerDefinition<unknown>);
      return registry;
    },
    triggers: () =>
      [...byChar.values()].map((d) => ({
        char: d.char,
        ...(d.label ? { label: d.label } : {}),
        ...(d.wordStart !== undefined ? { wordStart: d.wordStart } : {}),
        search: async (query: string) => {
          const found = await d.search(query);
          return (Array.isArray(found) ? found : []).map((item) => (d.toItem ? d.toItem(item) : (item as unknown as PromptTriggerItem)));
        },
        serialize: (item: PromptTriggerItem) => serializePill({ kind: d.kind, target: d.toTarget ? d.toTarget(item) : item.id, label: item.label }),
      })),
    chars: () => [...byChar.keys()],
  };
  for (const d of definitions) registry.register(d);
  return registry;
}

// Registers the German catalog of @kortex/db (the English source text is the key, see @kortex/i18n).
// Imported for its side effect by index.ts and by every module that translates, so each entry of
// the package's `exports` (./daily, ./tasks, ./radar, ...) has it loaded. The package only reads the
// language; the app or server that starts the work sets it.
import { registerCatalog, type Catalog } from "@kortex/i18n";
import db from "./de/db.json";

registerCatalog("de", db as Catalog);

/**
 * A record whose values are read through getters: the exported shape stays a plain
 * `Record<key, string>`, the text is resolved in the current language at every read.
 */
export function lazyLabels<K extends string>(sources: Record<K, () => string>): Readonly<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(sources) as K[])
    Object.defineProperty(out, key, { get: sources[key], enumerable: true });
  return out;
}

/** Same for a list: `list[i]`, `length`, iteration and `map` work as on a plain array. */
export function lazyList(sources: readonly (() => string)[]): readonly string[] {
  const out: string[] = [];
  out.length = sources.length;
  sources.forEach((get, i) => Object.defineProperty(out, i, { get, enumerable: true }));
  return out;
}

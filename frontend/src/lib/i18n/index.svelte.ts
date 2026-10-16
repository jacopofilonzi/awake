// i18n: `en.ts` is the source of truth; `it.ts` must have exactly the same keys (type-checked).
// t("section.key", { param }) replaces {param} placeholders. Language: the user's choice (stored in
// the browser), else the browser language, else English.

import { en } from "./en.ts";
import { it } from "./it.ts";
import { load, save } from "../storage.ts";

export const LOCALES = ["it", "en"] as const;
export type Locale = (typeof LOCALES)[number];

type Leaves<T> = { [K in keyof T]: T[K] extends string ? string : Leaves<T[K]> };
/** Shape every dictionary must have. */
export type Messages = Leaves<typeof en>;

type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];
export type Key = Paths<Messages>;

const dictionaries: Record<Locale, Messages> = { en, it };

function initial(): Locale {
  const stored = load("locale");
  if (stored === "it" || stored === "en") return stored;
  return navigator.language.toLowerCase().startsWith("it") ? "it" : "en";
}

export const i18n = $state<{ locale: Locale }>({ locale: initial() });
document.documentElement.lang = i18n.locale;

export function setLocale(locale: Locale): void {
  i18n.locale = locale;
  save("locale", locale);
  document.documentElement.lang = locale;
}

function lookup(dict: unknown, key: string): string | undefined {
  let node = dict;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function t(key: Key, params: Record<string, string | number> = {}): string {
  const text = lookup(dictionaries[i18n.locale], key) ?? lookup(en, key) ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

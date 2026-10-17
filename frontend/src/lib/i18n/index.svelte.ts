// i18n: `en.ts` is the source of truth; every other dictionary must have exactly the same keys
// (type-checked). t("section.key", { param }) replaces {param} placeholders. Language: the user's choice
// (stored in the browser), else the first of the browser's languages we have, else English.
// Adding a language: a dictionary file like it.ts, and one entry in LANGUAGES.

import { en } from "./en.ts";
import { it } from "./it.ts";
import { load, save } from "../storage.ts";

export type Locale = "en" | "it";

type Leaves<T> = { [K in keyof T]: T[K] extends string ? string : Leaves<T[K]> };
/** Shape every dictionary must have. */
export type Messages = Leaves<typeof en>;

type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];
export type Key = Paths<Messages>;

/** The languages of the UI, in the order the selector lists them; `name` is the language's own name. */
export const LANGUAGES: readonly { locale: Locale; name: string; messages: Messages }[] = [
  { locale: "en", name: "English", messages: en },
  { locale: "it", name: "Italiano", messages: it },
];

const dictionaries = Object.fromEntries(LANGUAGES.map((l) => [l.locale, l.messages])) as Record<Locale, Messages>;
const isLocale = (v: string | null): v is Locale => LANGUAGES.some((l) => l.locale === v);

function initial(): Locale {
  const stored = load("locale");
  if (isLocale(stored)) return stored;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split("-")[0] ?? "";
    if (isLocale(base)) return base;
  }
  return "en";
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

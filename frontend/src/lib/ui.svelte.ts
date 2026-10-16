// App-wide feedback: snackbar messages and a promise-based confirm dialog.

import { ApiFailure } from "./api.ts";
import { t, type Key } from "./i18n/index.svelte.ts";

interface Snack {
  id: number;
  text: string;
}

interface ConfirmRequest {
  title: string;
  text: string;
  confirm: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

export const ui = $state<{ snack: Snack | null; confirm: ConfirmRequest | null }>({ snack: null, confirm: null });

let snackTimer: ReturnType<typeof setTimeout> | undefined;
let snackId = 0;

export function snack(text: string): void {
  clearTimeout(snackTimer);
  ui.snack = { id: ++snackId, text };
  snackTimer = setTimeout(() => (ui.snack = null), 4000);
}

/** Translated text for an API error (or a generic one for anything else). */
export function errorText(err: unknown): string {
  if (err instanceof ApiFailure) {
    const key = `errors.${err.code}` as Key;
    const text = t(key);
    return text === key ? t("errors.INTERNAL") : text;
  }
  return t("errors.INTERNAL");
}

export function snackError(err: unknown): void {
  snack(errorText(err));
}

export function confirmDialog(opts: { title: string; text: string; confirm: string; danger?: boolean }): Promise<boolean> {
  ui.confirm?.resolve(false);
  return new Promise((resolve) => {
    ui.confirm = { ...opts, danger: opts.danger ?? false, resolve };
  });
}

export function answerConfirm(ok: boolean): void {
  const req = ui.confirm;
  ui.confirm = null;
  req?.resolve(ok);
}

export async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    snack(t("common.copied"));
  } catch {
    snack(t("common.copyFailed"));
  }
}

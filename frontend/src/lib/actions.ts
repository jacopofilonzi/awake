// Running a device action from the UI: confirmation for the long press (it can force a PC off), the
// API call, the new status into the store, errors as a snackbar. Shared by the tile and the device page.

import type { Device, DeviceAction } from "@awake/shared";
import { api } from "./api.ts";
import { data, setStatus } from "./data.svelte.ts";
import { t } from "./i18n/index.svelte.ts";
import { confirmDialog, snackError } from "./ui.svelte.ts";

/** Runs the action; resolves when done (also on failure or when the user cancels the confirmation). */
export async function runAction(device: Device, action: DeviceAction): Promise<void> {
  if (action === "long_press") {
    const ok = await confirmDialog({
      title: t("device.longPressTitle"),
      text: t("device.longPressText", { name: device.name }),
      confirm: t("device.longPress"),
      danger: true,
    });
    if (!ok) return;
  }
  try {
    const res = await api.devices.act(device.id, action);
    setStatus(device.id, res.status);
    data.actions++;
  } catch (err) {
    snackError(err);
  }
}

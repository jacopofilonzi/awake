// Light / dark / follow the system, applied as html[data-theme].

import { load, save } from "./storage.ts";

export type ThemeChoice = "system" | "light" | "dark";

const media = matchMedia("(prefers-color-scheme: dark)");
const stored = load("theme");

export const theme = $state<{ choice: ThemeChoice }>({
  choice: stored === "light" || stored === "dark" ? stored : "system",
});

function apply(): void {
  const dark = theme.choice === "dark" || (theme.choice === "system" && media.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#12100d" : "#efebe4");
}

media.addEventListener("change", apply);
apply();

export function setTheme(choice: ThemeChoice): void {
  theme.choice = choice;
  save("theme", choice === "system" ? null : choice);
  apply();
}

/** Rail button: cycles light → dark → system. */
export function cycleTheme(): void {
  setTheme(theme.choice === "light" ? "dark" : theme.choice === "dark" ? "system" : "light");
}

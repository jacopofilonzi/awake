// Per-browser preferences. Storage can be unavailable (private mode, blocked): never let it throw.

const PREFIX = "awake.";

export function load(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // Not persisted: the preference lasts for this page load only.
  }
}

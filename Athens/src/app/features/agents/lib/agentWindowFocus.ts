/** Beta: whether Avalon may focus Chrome when opening a job tab (not on every action). */
export const DEFAULT_ALLOW_WINDOW_FOCUS = true;
export const ALLOW_WINDOW_FOCUS_STORAGE_KEY = "athens-agent-allow-window-focus";

export function loadAllowWindowFocus(): boolean {
  try {
    const raw = localStorage.getItem(ALLOW_WINDOW_FOCUS_STORAGE_KEY);
    if (raw == null) return DEFAULT_ALLOW_WINDOW_FOCUS;
    if (raw === "0" || raw === "false") return false;
    if (raw === "1" || raw === "true") return true;
    return DEFAULT_ALLOW_WINDOW_FOCUS;
  } catch {
    return DEFAULT_ALLOW_WINDOW_FOCUS;
  }
}

export function saveAllowWindowFocus(value: boolean): void {
  try {
    localStorage.setItem(ALLOW_WINDOW_FOCUS_STORAGE_KEY, value ? "true" : "false");
  } catch {
    /* ignore quota / private mode */
  }
}

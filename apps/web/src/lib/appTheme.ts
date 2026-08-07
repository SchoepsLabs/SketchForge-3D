export const APP_THEME_STORAGE_KEY = "sketchForge.theme";

export const APP_THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

export type AppThemePreference = (typeof APP_THEME_OPTIONS)[number]["value"];
export type ResolvedAppTheme = Exclude<AppThemePreference, "system">;

/**
 * Light, not `system`, is the fallback.
 *
 * The fork ships a light theme tuned for reading geometry, but defaulting to
 * `system` meant anyone on a dark OS never saw it — which is exactly why the
 * retuned palette went unnoticed until the 2026-08-06 audit. `system` remains a
 * preference the user can pick; it is just no longer what you get by accident.
 */
export const DEFAULT_APP_THEME: AppThemePreference = "light";

export function normalizeAppThemePreference(value: unknown): AppThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : DEFAULT_APP_THEME;
}

export function resolveAppTheme(preference: AppThemePreference, prefersDark: boolean): ResolvedAppTheme {
  return preference === "system" ? (prefersDark ? "dark" : "light") : preference;
}

export function readStoredAppTheme(storage: Pick<Storage, "getItem"> | null | undefined): AppThemePreference {
  if (!storage) return DEFAULT_APP_THEME;
  try {
    return normalizeAppThemePreference(storage.getItem(APP_THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_APP_THEME;
  }
}

export function storeAppTheme(
  storage: Pick<Storage, "setItem"> | null | undefined,
  preference: AppThemePreference,
) {
  if (!storage) return;
  try {
    storage.setItem(APP_THEME_STORAGE_KEY, preference);
  } catch {
    // The selected theme still applies for this session when storage is unavailable.
  }
}

export function applyAppTheme(preference: AppThemePreference, prefersDark?: boolean) {
  if (typeof document === "undefined") return;
  const systemPrefersDark = prefersDark ?? (
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false
  );
  const resolved = resolveAppTheme(preference, systemPrefersDark);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

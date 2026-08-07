import { describe, expect, it } from "vitest";
import {
  APP_THEME_STORAGE_KEY,
  DEFAULT_APP_THEME,
  normalizeAppThemePreference,
  readStoredAppTheme,
  resolveAppTheme,
  storeAppTheme,
} from "@/lib/appTheme";

describe("application theme preference", () => {
  it("normalizes stored values and resolves the system theme", () => {
    expect(normalizeAppThemePreference("light")).toBe("light");
    expect(normalizeAppThemePreference("dark")).toBe("dark");
    expect(normalizeAppThemePreference("unexpected")).toBe(DEFAULT_APP_THEME);
    expect(resolveAppTheme("system", true)).toBe("dark");
    expect(resolveAppTheme("system", false)).toBe("light");
    expect(resolveAppTheme("light", true)).toBe("light");
  });

  it("defaults to light rather than following the OS", () => {
    // The regression this guards: with a `system` default, a dark-OS user never
    // saw the light theme the fork actually tunes for reading geometry.
    expect(DEFAULT_APP_THEME).toBe("light");
    expect(readStoredAppTheme(null)).toBe("light");
    expect(readStoredAppTheme({ getItem: () => null })).toBe("light");
  });

  it("still honours an explicit system preference once chosen", () => {
    expect(readStoredAppTheme({ getItem: () => "system" })).toBe("system");
    expect(resolveAppTheme("system", true)).toBe("dark");
  });

  it("falls back to light when storage throws", () => {
    expect(readStoredAppTheme({ getItem: () => { throw new Error("blocked"); } })).toBe("light");
  });

  it("persists the selected preference and safely falls back for invalid storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    storeAppTheme(storage, "dark");
    expect(values.get(APP_THEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredAppTheme(storage)).toBe("dark");
    values.set(APP_THEME_STORAGE_KEY, "neon");
    expect(readStoredAppTheme(storage)).toBe(DEFAULT_APP_THEME);
  });
});

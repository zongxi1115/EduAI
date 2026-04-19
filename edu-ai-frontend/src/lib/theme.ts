export const THEME_STORAGE_KEY = "eduai-theme"

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)"

export type ThemeMode = "light" | "dark"

function isThemeMode(value: string | null): value is ThemeMode {
    return value === "light" || value === "dark"
}

export function getStoredTheme(): ThemeMode | null {
    try {
        const value = window.localStorage.getItem(THEME_STORAGE_KEY)
        return isThemeMode(value) ? value : null
    } catch {
        return null
    }
}

export function getSystemTheme(): ThemeMode {
    if (window.matchMedia(SYSTEM_DARK_QUERY).matches) {
        return "dark"
    }
    return "light"
}

export function resolveInitialTheme(): ThemeMode {
    return getStoredTheme() ?? getSystemTheme()
}

export function applyTheme(theme: ThemeMode): void {
    const root = document.documentElement
    root.classList.toggle("dark", theme === "dark")
    root.style.colorScheme = theme
}

export function persistTheme(theme: ThemeMode): void {
    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
        // Ignore storage write failures (e.g. private mode restrictions).
    }
}
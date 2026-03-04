export type ThemePreference = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'xmpp-theme';

export function getThemePreference(): ThemePreference {
  return (localStorage.getItem(STORAGE_KEY) as ThemePreference) || 'auto';
}

export function setThemePreference(pref: ThemePreference) {
  localStorage.setItem(STORAGE_KEY, pref);
  applyTheme(pref);
}

export function applyTheme(pref?: ThemePreference) {
  const p = pref || getThemePreference();
  const root = document.documentElement;
  root.classList.remove('dark', 'light');
  if (p === 'dark') root.classList.add('dark');
  else if (p === 'light') root.classList.add('light');
  // 'auto' = no class, falls through to prefers-color-scheme media query
}

// Apply on load
applyTheme();

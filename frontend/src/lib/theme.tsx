'use client';
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'dark' | 'light';
const ThemeContext = createContext<{ theme: Theme; toggle: () => void; setTheme: (t: Theme) => void }>({ theme: 'dark', toggle: () => {}, setTheme: () => {} });

/** Runs before hydration (inline in <head>) so the saved theme applies without a flash. */
export const themeBootScript = `try{var t=localStorage.getItem('sf_theme');if(!t){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','dark')}`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    const cur = document.documentElement.getAttribute('data-theme');
    if (cur === 'light' || cur === 'dark') setThemeState(cur);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('sf_theme', t); } catch { /* storage blocked */ }
    window.dispatchEvent(new CustomEvent('sf-theme', { detail: t }));
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggle } = useTheme();
  return (
    <button onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: compact ? '6px 8px' : '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
      <span aria-hidden>{theme === 'dark' ? '☀️' : '🌙'}</span>{!compact && (theme === 'dark' ? 'Light' : 'Dark')}
    </button>
  );
}

/** Resolve a CSS custom property for canvas/SVG drawing (which cannot read var()). */
export function cssVar(name: string, fallback = '#888') {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

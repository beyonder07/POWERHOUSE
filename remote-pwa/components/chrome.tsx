'use client';

import { useEffect, useState } from 'react';

export type ThemeMode = 'dark' | 'light';

export function useThemeState(storageKey = 'powerhouse-remote-theme') {
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
      document.documentElement.setAttribute('data-theme', stored);
      setReady(true);
      return;
    }

    const initialTheme: ThemeMode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    setTheme(initialTheme);
    document.documentElement.setAttribute('data-theme', initialTheme);
    setReady(true);
  }, [storageKey]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem(storageKey, theme);
  }, [ready, storageKey, theme]);

  return {
    theme,
    setTheme,
    toggleTheme: () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  };
}

export function ThemeGlyph({ theme }: { theme: ThemeMode }) {
  if (theme === 'dark') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3.75V6m0 12v2.25M4.75 12H7m10 0h2.25M6.87 6.87l1.59 1.59m7.08 7.08 1.59 1.59m0-10.26-1.59 1.59m-7.08 7.08-1.59 1.59M12 8.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M18.25 14.5A7.25 7.25 0 0 1 9.5 5.75a7.25 7.25 0 1 0 8.75 8.75Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function ThemeToggle({
  theme,
  onToggle,
  compact = false
}: {
  theme: ThemeMode;
  onToggle: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={`theme-toggle ${compact ? 'compact' : ''}`.trim()}
      onClick={onToggle}
      aria-label={theme === 'dark' ? 'Switch to bright mode' : 'Switch to dark mode'}
    >
      <ThemeGlyph theme={theme} />
      <span>{theme === 'dark' ? 'Bright Mode' : 'Dark Mode'}</span>
    </button>
  );
}

export function BrandLogo() {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="brand-fallback" aria-label="PowerHouse logo fallback">
        <span>PH</span>
      </div>
    );
  }

  return (
    <img
      className="brand-logo"
      src="/powerhouse-logo.jpg"
      alt="PowerHouse Gym logo"
      onError={() => setFailed(true)}
    />
  );
}

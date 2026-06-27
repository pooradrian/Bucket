import React, {createContext, useContext, useMemo} from 'react';
import {AppSettings} from './store';
import {createStyles} from './styles';

type Styles = ReturnType<typeof createStyles>;

const ThemeContext = createContext<Styles | null>(null);

export function ThemeProvider({
  settings,
  children,
}: {
  settings: AppSettings;
  children: React.ReactNode;
}) {
  const styles = useMemo(() => createStyles(settings), [settings]);
  return (
    <ThemeContext.Provider value={styles}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): Styles {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

import { useEffect, useState } from 'react';
import App from './App';
import ErrorBoundary from './ui/ErrorBoundary';
import { installThemeBridge, type HostTheme } from './host-theme';
import { ThemeContext } from './ui/theme';

// First-paint guess until the shell's CRIBL_APP_LAYOUT message arrives (see AGENTS.md).
const initialTheme: HostTheme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

export default function Root() {
  const [theme, setTheme] = useState<HostTheme>(initialTheme);
  useEffect(() => installThemeBridge(setTheme), []);
  return (
    <ThemeContext.Provider value={theme}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ThemeContext.Provider>
  );
}

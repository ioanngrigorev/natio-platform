"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type Theme = "light" | "dark" | "mint";
const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void }>({ theme: "light", setTheme: () => {} });

export function AdminThemeProvider({ initialTheme, children }: { initialTheme: Theme; children: ReactNode }) {
  const [theme, update] = useState(initialTheme);
  function setTheme(next: Theme) {
    update(next);
    document.cookie = `natio_admin_theme=${next}; Path=/admin; Max-Age=31536000; SameSite=Lax; Secure`;
  }
  return <ThemeContext.Provider value={{ theme, setTheme }}><div className="admin-theme" data-theme={theme}>{children}</div></ThemeContext.Provider>;
}

export function AdminThemeToggle() {
  const { theme, setTheme } = useContext(ThemeContext);
  return <div className="admin-theme-toggle" role="group" aria-label="Color theme">{(["light", "dark", "mint"] as const).map(t => <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)} title={`${t === "light" ? "Light" : t === "dark" ? "Dark" : "Mint"} theme`}>{t === "light" ? "☀ Light" : t === "dark" ? "☾ Dark" : "◈ Mint"}</button>)}</div>;
}

"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type Theme = "light" | "dark" | "mint";
const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void; sidebar: "light"|"dark"; setSidebar:(value:"light"|"dark")=>void }>({ theme: "light", setTheme: () => {}, sidebar:"light",setSidebar:()=>{} });

export function AdminThemeProvider({ initialTheme, initialSidebar, children }: { initialTheme: Theme; initialSidebar:"light"|"dark"; children: ReactNode }) {
  const [theme, update] = useState(initialTheme);
  const [sidebar,updateSidebar]=useState(initialSidebar);
  function setSidebar(next:"light"|"dark"){updateSidebar(next);document.cookie=`natio_admin_sidebar=${next}; Path=/admin; Max-Age=31536000; SameSite=Lax; Secure`;}
  function setTheme(next: Theme) {
    update(next);
    document.cookie = `natio_admin_theme=${next}; Path=/admin; Max-Age=31536000; SameSite=Lax; Secure`;
  }
  return <ThemeContext.Provider value={{ theme, setTheme, sidebar, setSidebar }}><div className="admin-theme" data-theme={theme} data-sidebar={sidebar}>{children}</div></ThemeContext.Provider>;
}

export function AdminThemeToggle() {
  const { theme, setTheme } = useContext(ThemeContext);
  return <div className="admin-theme-toggle" role="group" aria-label="Color theme">{(["light", "dark", "mint"] as const).map(t => <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)} title={`${t === "light" ? "Light" : t === "dark" ? "Dark" : "Mint"} theme`}>{t === "light" ? "☀ Light" : t === "dark" ? "☾ Dark" : "◈ Mint"}</button>)}</div>;
}

export function SidebarThemeToggle(){const {theme,sidebar,setSidebar}=useContext(ThemeContext);if(theme!=='light')return null;return <div className="sidebar-tone px-3 py-3"><p className="mb-2 text-[10px] font-medium uppercase tracking-wider">Menu appearance</p><div role="group" aria-label="Sidebar appearance" className="flex rounded-lg border border-ink-200 p-1">{(['light','dark'] as const).map(s=><button key={s} type="button" aria-pressed={sidebar===s} onClick={()=>setSidebar(s)} className="flex-1 rounded-md px-2 py-1.5 text-xs">{s==='light'?'☀ Light menu':'☾ Dark menu'}</button>)}</div></div>}

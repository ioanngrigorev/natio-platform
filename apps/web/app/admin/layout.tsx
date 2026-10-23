import "./theme.css";
import { cookies } from "next/headers";
import { AdminThemeProvider } from "@/components/admin/theme-provider";

/** The investor palette is intentionally confined to the admin route. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("natio_admin_theme")?.value;
  return <AdminThemeProvider initialSidebar={(await cookies()).get("natio_admin_sidebar")?.value === "dark" ? "dark" : "light"} initialTheme={theme === "mint" ? "mint" : theme === "dark" ? "dark" : "light"}>{children}</AdminThemeProvider>;
}

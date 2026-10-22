import "./theme.css";
import { cookies } from "next/headers";
import { AdminThemeProvider } from "@/components/admin/theme-provider";

/** The investor palette is intentionally confined to the admin route. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminThemeProvider initialTheme={cookies().get("natio_admin_theme")?.value === "dark" ? "dark" : "light"}>{children}</AdminThemeProvider>;
}

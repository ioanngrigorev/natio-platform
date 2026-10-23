
import {getI18n} from '@/lib/i18n/server';
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminAuthLayout({ children }: { children: React.ReactNode }) {
 const {t:translateUi,locale:uiLocale}=getI18n();

  const session = await getAdminSession();
  if (session) redirect("/admin");
  return (
    <div className="admin-auth flex min-h-screen flex-col items-center justify-center bg-ink-900 px-4 py-10">
      <div className="admin-auth-logo mb-6 flex items-center gap-2 text-white">
        <span className="flex h-7 w-7 items-center justify-center rounded bg-white text-[12px] font-bold text-ink-900">{translateUi("N")}</span>
        <span className="text-[16px] font-semibold tracking-tight">{translateUi("NATIO")}</span>
        <span className="ml-1 rounded bg-ink-700 px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-wide text-ink-200">{translateUi("Admin")}</span>
      </div>
      <div className="w-full max-w-[400px] rounded-lg bg-white p-6 shadow-card">{children}</div>
    </div>
  );
}

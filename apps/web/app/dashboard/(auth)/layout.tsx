import Link from "next/link";
import { redirect } from "next/navigation";
import { getMerchantSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardAuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getMerchantSession();
  if (session) redirect("/dashboard");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded bg-ink-900 text-[12px] font-bold text-white">N</span>
        <span className="text-[16px] font-semibold tracking-tight">NATIO</span>
      </Link>
      <div className="w-full max-w-[400px] rounded-lg bg-white p-6 shadow-card">{children}</div>
      <p className="mt-6 max-w-[400px] text-center text-[11.5px] leading-5 text-ink-400">
        NATIO is a payment orchestration technology platform. Funds are processed and settled by licensed payment providers connected to the platform.
      </p>
    </div>
  );
}

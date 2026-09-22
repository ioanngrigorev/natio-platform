import Link from "next/link";

/**
 * Root boundary: this renders for any unmatched URL, which in practice is the
 * public site. The dashboard and admin ship their own light not-found files so
 * an in-app notFound() does not drop a dark page into a light surface.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-night-950 px-5 text-center">
      <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-mist-400">
        <span className="h-[5px] w-[5px] rounded-full bg-iris" aria-hidden />
        <span>Error 404</span>
      </div>
      <h1 className="mt-5 text-[34px] font-medium leading-[1.05] tracking-[-0.03em] text-mist-50 md:text-[44px]">Page not found.</h1>
      <p className="mt-4 max-w-sm text-[15px] leading-[1.7] text-mist-400">The page you requested does not exist, moved, or you do not have access to it.</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className="inline-flex h-10 items-center rounded-full bg-mist-50 px-5 text-[14px] font-medium text-night-950 transition-colors hover:bg-white">
          Back to natio.me
        </Link>
        <Link href="/docs" className="inline-flex h-10 items-center rounded-full border border-night-600 px-5 text-[14px] font-medium text-mist-200 transition-colors hover:border-mist-400 hover:text-mist-50">
          Documentation
        </Link>
      </div>
    </div>
  );
}

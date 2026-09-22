import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES } from "@/components/marketing/nav";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://natio.me").replace(/\/$/, "");

/** Marketing pages first, then documentation; the home page carries the highest priority. */
function priorityFor(route: string): number {
  if (route === "/") return 1;
  if (route.startsWith("/docs")) return route === "/docs" ? 0.7 : 0.6;
  if (route === "/contact") return 0.6;
  return 0.8;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route === "/" ? "" : route}`,
    lastModified,
    changeFrequency: route.startsWith("/docs") ? ("weekly" as const) : ("monthly" as const),
    priority: priorityFor(route),
  }));
}

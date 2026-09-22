/**
 * Publishes the NATIO OpenAPI 3.1 document on the website origin so that
 * `https://<site>/openapi.json` can be handed to code generators directly.
 * The document itself is produced by the API service.
 */
export const dynamic = "force-dynamic";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL || "http://localhost:4000";

export async function GET(): Promise<Response> {
  try {
    const res = await fetch(`${API_INTERNAL_URL}/openapi.json`, { cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`upstream responded ${res.status}`);
    const body = await res.text();
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response(JSON.stringify({ error: { type: "internal_error", code: "spec_unavailable", message: "The OpenAPI document could not be loaded." } }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}

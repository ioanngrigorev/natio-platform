import { isIP } from "node:net";
import dns from "node:dns/promises";

/** Supports exact IPs and CIDR (v4 and v6 /prefix). */
export function isIpAllowed(ip: string, allowList: string[]): boolean {
  const norm = normalizeIp(ip);
  for (const entry of allowList) {
    const e = entry.trim();
    if (!e) continue;
    if (e.includes("/")) {
      if (cidrContains(e, norm)) return true;
    } else if (normalizeIp(e) === norm) {
      return true;
    }
  }
  return false;
}

/**
 * Reduce an address to its canonical comparable form: brackets removed and IPv4-mapped IPv6
 * rewritten as dotted quad. The WHATWG URL parser rewrites ::ffff:169.254.169.254 as
 * ::ffff:a9fe:a9fe, so the hex form has to be understood too or a mapped private address
 * would slip past the IPv4 range checks.
 */
function normalizeIp(ip: string): string {
  let v = ip.trim();
  if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
  if (v.toLowerCase().startsWith("::ffff:")) {
    const rest = v.slice(7);
    if (isIP(rest) === 4) return rest;
    const hex = /^([0-9a-fA-F]{1,4}):([0-9a-fA-F]{1,4})$/.exec(rest);
    if (hex) {
      const hi = Number.parseInt(hex[1]!, 16);
      const lo = Number.parseInt(hex[2]!, 16);
      return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    }
  }
  return v;
}

function ipToBigInt(ip: string): { value: bigint; bits: number } | null {
  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map(Number);
    let v = 0n;
    for (const p of parts) v = (v << 8n) + BigInt(p);
    return { value: v, bits: 32 };
  }
  if (version === 6) {
    const [head, tail] = ip.split("::");
    const headParts = head ? head.split(":") : [];
    const tailParts = tail ? tail.split(":") : [];
    const missing = 8 - headParts.length - tailParts.length;
    const parts = [...headParts, ...Array(Math.max(missing, 0)).fill("0"), ...tailParts];
    let v = 0n;
    for (const p of parts) v = (v << 16n) + BigInt(Number.parseInt(p || "0", 16));
    return { value: v, bits: 128 };
  }
  return null;
}

function cidrContains(cidr: string, ip: string): boolean {
  const [range, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  const r = ipToBigInt(range!);
  const t = ipToBigInt(ip);
  if (!r || !t || r.bits !== t.bits || !Number.isInteger(prefix) || prefix < 0 || prefix > r.bits) return false;
  const shift = BigInt(r.bits - prefix);
  return r.value >> shift === t.value >> shift;
}

const PRIVATE_V4 = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16", "0.0.0.0/8", "100.64.0.0/10"];

export function isPrivateIp(ip: string): boolean {
  const n = normalizeIp(ip);
  if (isIP(n) === 4) return PRIVATE_V4.some((c) => cidrContains(c, n));
  if (isIP(n) === 6) return n === "::1" || n.toLowerCase().startsWith("fc") || n.toLowerCase().startsWith("fd") || n.toLowerCase().startsWith("fe80");
  return false;
}

/**
 * Validate an outbound webhook URL: https (http allowed only in dev), no credentials,
 * and (unless allowed) not resolving to private/loopback addresses (SSRF protection).
 */
export async function validateOutboundUrl(raw: string, opts: { allowPrivate: boolean; allowHttp: boolean }): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "URL is not valid";
  }
  if (url.protocol !== "https:" && !(opts.allowHttp && url.protocol === "http:")) return "URL must use https";
  if (url.username || url.password) return "URL must not contain credentials";
  if (opts.allowPrivate) return null;
  // URL.hostname keeps the brackets around an IPv6 literal, which would hide it from isIP().
  const host = url.hostname.startsWith("[") && url.hostname.endsWith("]") ? url.hostname.slice(1, -1) : url.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return "URL must be publicly reachable";
  if (isIP(host)) return isPrivateIp(host) ? "URL must not point to a private network" : null;
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (addrs.some((a) => isPrivateIp(a.address))) return "URL must not resolve to a private network";
  } catch {
    return "URL hostname could not be resolved";
  }
  return null;
}

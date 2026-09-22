import { describe, expect, it } from "vitest";
import { isIpAllowed, isPrivateIp, validateOutboundUrl } from "../../src/lib/net.js";
import { isLocalDatabaseHost } from "../../src/config.js";

describe("isIpAllowed", () => {
  it("matches exact IPv4 and IPv6 entries", () => {
    expect(isIpAllowed("203.0.113.5", ["203.0.113.5"])).toBe(true);
    expect(isIpAllowed("203.0.113.6", ["203.0.113.5"])).toBe(false);
    expect(isIpAllowed("2001:db8::1", ["2001:db8::1"])).toBe(true);
    expect(isIpAllowed("2001:db8::2", ["2001:db8::1"])).toBe(false);
    expect(isIpAllowed("203.0.113.5", ["1.1.1.1", "203.0.113.5"])).toBe(true);
  });

  it("matches IPv4 CIDR ranges", () => {
    expect(isIpAllowed("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(isIpAllowed("11.0.0.1", ["10.0.0.0/8"])).toBe(false);
    expect(isIpAllowed("192.168.1.77", ["192.168.1.0/24"])).toBe(true);
    expect(isIpAllowed("192.168.2.1", ["192.168.1.0/24"])).toBe(false);
    expect(isIpAllowed("203.0.113.5", ["203.0.113.5/32"])).toBe(true);
    expect(isIpAllowed("203.0.113.4", ["203.0.113.5/32"])).toBe(false);
    expect(isIpAllowed("8.8.8.8", ["0.0.0.0/0"])).toBe(true);
    expect(isIpAllowed("172.20.5.5", ["172.16.0.0/12"])).toBe(true);
    expect(isIpAllowed("172.32.0.1", ["172.16.0.0/12"])).toBe(false);
  });

  it("matches IPv6 CIDR ranges", () => {
    expect(isIpAllowed("2001:db8:abcd::42", ["2001:db8::/32"])).toBe(true);
    expect(isIpAllowed("2001:db9::1", ["2001:db8::/32"])).toBe(false);
    expect(isIpAllowed("2001:db8::1", ["2001:db8::1/128"])).toBe(true);
    expect(isIpAllowed("2001:db8::2", ["2001:db8::1/128"])).toBe(false);
    expect(isIpAllowed("fd12:3456:789a:1::1", ["fd12:3456:789a::/48"])).toBe(true);
    expect(isIpAllowed("::1", ["::/0"])).toBe(true);
  });

  it("normalises IPv4-mapped IPv6 addresses (::ffff:a.b.c.d)", () => {
    expect(isIpAllowed("::ffff:203.0.113.5", ["203.0.113.5"])).toBe(true);
    expect(isIpAllowed("::ffff:10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(isIpAllowed("203.0.113.5", ["::ffff:203.0.113.5"])).toBe(true);
    expect(isIpAllowed("::ffff:203.0.113.6", ["203.0.113.5"])).toBe(false);
  });

  it("does not match across families and ignores invalid or empty entries", () => {
    expect(isIpAllowed("10.0.0.1", ["2001:db8::/32"])).toBe(false);
    expect(isIpAllowed("2001:db8::1", ["10.0.0.0/8"])).toBe(false);
    expect(isIpAllowed("10.0.0.1", ["", "  ", "not-an-ip", "10.0.0.0/8"])).toBe(true);
    expect(isIpAllowed("10.0.0.1", ["not-an-ip/8"])).toBe(false);
    expect(isIpAllowed("10.0.0.1", ["10.0.0.0/33"])).toBe(false);
    expect(isIpAllowed("10.0.0.1", ["10.0.0.0/-1"])).toBe(false);
    expect(isIpAllowed("10.0.0.1", ["10.0.0.0/abc"])).toBe(false);
    expect(isIpAllowed("10.0.0.1", [])).toBe(false);
    expect(isIpAllowed("garbage", ["10.0.0.0/8"])).toBe(false);
  });

  it("tolerates surrounding whitespace in entries", () => {
    expect(isIpAllowed("10.0.0.1", [" 10.0.0.0/8 "])).toBe(true);
    expect(isIpAllowed("203.0.113.5", [" 203.0.113.5 "])).toBe(true);
  });
});

describe("isPrivateIp", () => {
  it("recognises private / loopback / link-local / CGNAT IPv4 ranges", () => {
    for (const ip of ["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.0.1", "127.0.0.1", "127.1.2.3", "169.254.10.10", "0.0.0.0", "100.64.0.1", "100.127.255.255"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("recognises public IPv4 addresses", () => {
    for (const ip of ["8.8.8.8", "203.0.113.5", "172.32.0.1", "172.15.255.255", "100.128.0.1", "11.0.0.1", "1.1.1.1"]) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("recognises private IPv6 (loopback, ULA, link-local) and public IPv6", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("fd12:3456::1")).toBe(true);
    expect(isPrivateIp("FD12:3456::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("2001:db8::1")).toBe(false);
    expect(isPrivateIp("2606:4700::1111")).toBe(false);
  });

  it("normalises IPv4-mapped IPv6 addresses", () => {
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:192.168.1.1")).toBe(true);
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
    // Hex form, as the WHATWG URL parser writes it.
    expect(isPrivateIp("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true); // 127.0.0.1
    expect(isPrivateIp("::ffff:808:808")).toBe(false); // 8.8.8.8
  });

  it("returns false for non-IP strings", () => {
    expect(isPrivateIp("localhost")).toBe(false);
    expect(isPrivateIp("")).toBe(false);
    expect(isPrivateIp("999.1.1.1")).toBe(false);
  });
});

describe("validateOutboundUrl", () => {
  it("rejects invalid URLs, non-https (unless allowed) and credentials", async () => {
    expect(await validateOutboundUrl("not a url", { allowPrivate: true, allowHttp: true })).toBe("URL is not valid");
    expect(await validateOutboundUrl("http://example.com/hook", { allowPrivate: true, allowHttp: false })).toBe("URL must use https");
    expect(await validateOutboundUrl("ftp://example.com/hook", { allowPrivate: true, allowHttp: true })).toBe("URL must use https");
    expect(await validateOutboundUrl("https://user:pw@example.com/hook", { allowPrivate: true, allowHttp: true })).toBe("URL must not contain credentials");
    expect(await validateOutboundUrl("http://127.0.0.1:9999/hook", { allowPrivate: true, allowHttp: true })).toBeNull();
  });

  it("blocks private hosts and literal private IPs when private URLs are not allowed", async () => {
    expect(await validateOutboundUrl("https://localhost/hook", { allowPrivate: false, allowHttp: true })).toBe("URL must be publicly reachable");
    expect(await validateOutboundUrl("https://printer.local/hook", { allowPrivate: false, allowHttp: true })).toBe("URL must be publicly reachable");
    expect(await validateOutboundUrl("https://svc.internal/hook", { allowPrivate: false, allowHttp: true })).toBe("URL must be publicly reachable");
    expect(await validateOutboundUrl("https://127.0.0.1/hook", { allowPrivate: false, allowHttp: true })).toBe("URL must not point to a private network");
    expect(await validateOutboundUrl("https://10.0.0.5/hook", { allowPrivate: false, allowHttp: true })).toBe("URL must not point to a private network");
    expect(await validateOutboundUrl("https://[::1]/hook", { allowPrivate: false, allowHttp: true })).not.toBeNull();
    expect(await validateOutboundUrl("https://203.0.113.5/hook", { allowPrivate: false, allowHttp: true })).toBeNull();
  });

  it("applies the private-range check to IPv6 literals, including IPv4-mapped forms", async () => {
    // URL.hostname keeps the brackets and rewrites ::ffff:169.254.169.254 as ::ffff:a9fe:a9fe.
    for (const url of ["https://[::1]/x", "https://[fd00::1]/x", "https://[fe80::1]/x", "https://[::ffff:169.254.169.254]/x", "https://[::ffff:10.0.0.1]/x"]) {
      expect(await validateOutboundUrl(url, { allowPrivate: false, allowHttp: true }), url).toBe("URL must not point to a private network");
    }
    expect(await validateOutboundUrl("https://[2606:4700::1111]/x", { allowPrivate: false, allowHttp: true })).toBeNull();
    expect(await validateOutboundUrl("https://[::ffff:8.8.8.8]/x", { allowPrivate: false, allowHttp: true })).toBeNull();
  });
});

describe("isLocalDatabaseHost", () => {
  it("treats compose service names and loopback as local", () => {
    expect(isLocalDatabaseHost("postgres://u:p@postgres:5432/natio")).toBe(true);
    expect(isLocalDatabaseHost("postgres://u:p@localhost:5432/natio")).toBe(true);
    expect(isLocalDatabaseHost("postgres://u:p@127.0.0.1:5432/natio")).toBe(true);
    expect(isLocalDatabaseHost("postgres://u:p@db:5432/natio")).toBe(true);
  });

  it("treats private IPv4 ranges as local", () => {
    expect(isLocalDatabaseHost("postgres://u:p@10.1.2.3:5432/natio")).toBe(true);
    expect(isLocalDatabaseHost("postgres://u:p@172.18.0.2:5432/natio")).toBe(true);
    expect(isLocalDatabaseHost("postgres://u:p@192.168.1.10:5432/natio")).toBe(true);
  });

  it("treats routed hosts as remote, so production demands TLS", () => {
    expect(isLocalDatabaseHost("postgres://u:p@db.example.com:5432/natio")).toBe(false);
    expect(isLocalDatabaseHost("postgres://u:p@1.2.3.4:5432/natio")).toBe(false);
    expect(isLocalDatabaseHost("postgres://u:p@my-db.rds.amazonaws.com:5432/natio")).toBe(false);
    expect(isLocalDatabaseHost("postgres://u:p@172.32.0.1:5432/natio")).toBe(false);
  });
});

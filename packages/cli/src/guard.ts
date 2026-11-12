// Fetches http(s) URLs while blocking private network addresses. Only the MCP server uses this path, so api.ts's fetchUrl loads it on first use (loading the built-in modules here takes about 8 ms, so it stays out of CLI command startup)
import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { pipeline, type Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { CliText } from "./messages";

/** IPv4 addresses that point to a private network, this machine, or cloud metadata */
const PRIVATE_V4 = [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const;
/** An IPv4 address a.b.c.d as two 16-bit groups of IPv6 text (aabb:ccdd) */
const v4Groups = (ip: string) => {
  const [a, b, c, d] = ip.split(".").map(Number);
  return `${(a * 256 + b).toString(16)}:${(c * 256 + d).toString(16)}`;
};
const PRIVATE = new BlockList();
for (const [net, bits] of PRIVATE_V4) {
  // IPv4 rules apply to the ::ffff: form automatically. IPv6 forms that embed IPv4 (NAT64 64:ff9b::/96, 6to4 2002::/16) get the same ranges added separately.
  // Blocking all of NAT64 would make every IPv4-only site unreachable from IPv6-only networks (DNS64), so the decision uses the embedded IPv4
  PRIVATE.addSubnet(net, bits, "ipv4");
  PRIVATE.addSubnet(`64:ff9b::${v4Groups(net)}`, 96 + bits, "ipv6");
  PRIVATE.addSubnet(`2002:${v4Groups(net)}::`, 16 + bits, "ipv6");
}
// This machine and the old IPv4-compatible form (::/96), local-use NAT64 whose IPv4 part the operator chooses (64:ff9b:1::/48), private (fc00::/7), link-local (fe80::/10), old site-local (fec0::/10), multicast (ff00::/8)
for (const [net, bits] of [["::", 96], ["64:ff9b:1::", 48], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]] as const) PRIVATE.addSubnet(net, bits, "ipv6");
export const isPrivateAddress = (a: string) => {
  const v = isIP(a);
  return v !== 0 && PRIVATE.check(a, v === 6 ? "ipv6" : "ipv4");
};

/** Does not connect when any address dns.lookup finds is private. With Node's default automatic family selection (autoSelectFamily), it is called with all: true and receives an array of addresses */
const publicLookup =
  (t: CliText): LookupFunction =>
  (hostname, options, callback) =>
    dnsLookup(hostname, options, (err, address, family) => {
      const list = typeof address === "string" ? [address] : (address ?? []).map((a) => a.address);
      callback(err ?? (list.some(isPrivateAddress) ? new Error(t.privateUrl) : null), address, family);
    });

/** The default headers fetch sends. Both paths send the same request, so APIs that reject requests without a User-Agent (GitHub REST and others) accept both alike */
const FETCH_HEADERS = { accept: "*/*", "accept-language": "*", "user-agent": "node", "accept-encoding": "gzip, deflate, br" };
const REDIRECT = new Set([301, 302, 303, 307, 308]);
/** Redirect limit, the same as the fetch standard */
const MAX_REDIRECTS = 20;

/**
 * Fetches while blocking private network addresses. It checks the address at the moment of connecting, which also blocks the bypass where DNS returns a different address after the check (rebinding).
 * fetch has no place to hook this check in, so it uses http(s).request. Like fetch, it follows up to 20 redirects and runs the same check each time.
 * Returns the last response that is not a redirect. The caller checks the status code
 */
export async function getPublic(url: URL, signal: AbortSignal, t: CliText): Promise<IncomingMessage> {
  const lookup = publicLookup(t);
  for (let hops = 0; ; hops++) {
    // A URL with a literal IP skips lookup, so it is checked here (URL also turns forms such as 2130706433 into 127.0.0.1)
    if (isPrivateAddress(url.hostname.replace(/^\[(.*)\]$/, "$1"))) throw new Error(t.privateUrl);
    const res = await new Promise<IncomingMessage>((resolve, reject) => {
      (url.protocol === "https:" ? httpsRequest : httpRequest)(url, { signal, lookup, headers: FETCH_HEADERS }, resolve).on("error", reject).end();
    });
    if (!REDIRECT.has(res.statusCode ?? 0) || !res.headers.location) return res;
    // Close the connection without reading the redirect body (resume would download the discarded body to the end, with no limit)
    res.destroy();
    const next = new URL(res.headers.location, url);
    if (hops >= MAX_REDIRECTS) throw new Error(t.tooManyRedirects);
    if (next.protocol !== "http:" && next.protocol !== "https:") throw new Error(t.httpOnly);
    url = next;
  }
}

/** Decodes according to content-encoding. fetch decodes on its own, but http.request returns the body as received */
export function decoded(res: IncomingMessage): Readable {
  const enc = (res.headers["content-encoding"] ?? "").trim().toLowerCase();
  const z = enc === "gzip" || enc === "x-gzip" ? createGunzip() : enc === "deflate" ? createInflate() : enc === "br" ? createBrotliDecompress() : null;
  return z ? pipeline(res, z, () => {}) : res;
}

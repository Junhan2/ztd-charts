// 내부망 주소를 막고 http(s) 주소를 가져와요. MCP 서버만 쓰는 길이라, api.ts의 fetchUrl이 처음 쓸 때 불러와요 (여기 내장 모듈을 읽는 데 약 8 ms가 걸려서 CLI 명령 시작에 넣지 않아요)
import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { pipeline, type Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { CliText } from "./messages";

/** 내부망, 이 컴퓨터, 클라우드 메타데이터를 가리키는 IPv4 주소 */
const PRIVATE_V4 = [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const;
/** IPv4 주소 a.b.c.d를 IPv6 글자의 16비트 두 묶음(aabb:ccdd)으로 */
const v4Groups = (ip: string) => {
  const [a, b, c, d] = ip.split(".").map(Number);
  return `${(a * 256 + b).toString(16)}:${(c * 256 + d).toString(16)}`;
};
const PRIVATE = new BlockList();
for (const [net, bits] of PRIVATE_V4) {
  // IPv4 규칙은 ::ffff: 꼴에 저절로 걸려요. IPv4를 품는 IPv6 꼴(NAT64 64:ff9b::/96, 6to4 2002::/16)에는 같은 범위를 따로 걸어요.
  // NAT64를 통째로 막으면 IPv6 전용 망(DNS64)에서 IPv4만 있는 사이트를 모두 못 가져와서, 안에 든 IPv4로 판단해요
  PRIVATE.addSubnet(net, bits, "ipv4");
  PRIVATE.addSubnet(`64:ff9b::${v4Groups(net)}`, 96 + bits, "ipv6");
  PRIVATE.addSubnet(`2002:${v4Groups(net)}::`, 16 + bits, "ipv6");
}
// 이 컴퓨터와 옛 IPv4 호환 꼴(::/96), IPv4 자리를 운영자가 정하는 지역용 NAT64(64:ff9b:1::/48), 사설(fc00::/7), 링크 로컬(fe80::/10), 옛 사이트 로컬(fec0::/10), 멀티캐스트(ff00::/8)
for (const [net, bits] of [["::", 96], ["64:ff9b:1::", 48], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]] as const) PRIVATE.addSubnet(net, bits, "ipv6");
export const isPrivateAddress = (a: string) => {
  const v = isIP(a);
  return v !== 0 && PRIVATE.check(a, v === 6 ? "ipv6" : "ipv4");
};

/** dns.lookup이 찾은 주소가 하나라도 내부망이면 연결하지 않아요. Node 기본값인 자동 선택(autoSelectFamily)에서는 all: true로 불려 주소 배열을 받아요 */
const publicLookup =
  (t: CliText): LookupFunction =>
  (hostname, options, callback) =>
    dnsLookup(hostname, options, (err, address, family) => {
      const list = typeof address === "string" ? [address] : (address ?? []).map((a) => a.address);
      callback(err ?? (list.some(isPrivateAddress) ? new Error(t.privateUrl) : null), address, family);
    });

/** fetch가 보내는 기본 머리글이에요. 두 경로가 같은 요청을 보내서, User-Agent가 없으면 거절하는 API(GitHub REST 등)도 똑같이 받아요 */
const FETCH_HEADERS = { accept: "*/*", "accept-language": "*", "user-agent": "node", "accept-encoding": "gzip, deflate, br" };
const REDIRECT = new Set([301, 302, 303, 307, 308]);
/** fetch 표준과 같은 리디렉트 한도 */
const MAX_REDIRECTS = 20;

/**
 * 내부망 주소를 막고 가져와요. 연결하는 순간의 주소를 검사해서, 확인한 뒤 DNS가 다른 주소를 주는 우회(리바인딩)도 막아요.
 * fetch는 이 검사를 끼울 자리가 없어서 http(s).request를 써요. 리디렉트는 fetch처럼 20번까지 따라가며 매번 같은 검사를 해요.
 * 리디렉트가 아닌 마지막 응답을 돌려줘요. 상태 코드는 부르는 쪽이 봐요
 */
export async function getPublic(url: URL, signal: AbortSignal, t: CliText): Promise<IncomingMessage> {
  const lookup = publicLookup(t);
  for (let hops = 0; ; hops++) {
    // IP를 그대로 쓴 주소는 lookup을 거치지 않아서 여기서 봐요 (URL은 2130706433 같은 꼴도 127.0.0.1로 바꿔 줘요)
    if (isPrivateAddress(url.hostname.replace(/^\[(.*)\]$/, "$1"))) throw new Error(t.privateUrl);
    const res = await new Promise<IncomingMessage>((resolve, reject) => {
      (url.protocol === "https:" ? httpsRequest : httpRequest)(url, { signal, lookup, headers: FETCH_HEADERS }, resolve).on("error", reject).end();
    });
    if (!REDIRECT.has(res.statusCode ?? 0) || !res.headers.location) return res;
    // 리디렉트 본문은 읽지 않고 연결을 끊어요 (resume은 버릴 본문을 한도 없이 끝까지 받아요)
    res.destroy();
    const next = new URL(res.headers.location, url);
    if (hops >= MAX_REDIRECTS) throw new Error(t.tooManyRedirects);
    if (next.protocol !== "http:" && next.protocol !== "https:") throw new Error(t.httpOnly);
    url = next;
  }
}

/** content-encoding대로 풀어요. fetch는 알아서 풀지만 http.request는 받은 그대로 줘요 */
export function decoded(res: IncomingMessage): Readable {
  const enc = (res.headers["content-encoding"] ?? "").trim().toLowerCase();
  const z = enc === "gzip" || enc === "x-gzip" ? createGunzip() : enc === "deflate" ? createInflate() : enc === "br" ? createBrotliDecompress() : null;
  return z ? pipeline(res, z, () => {}) : res;
}

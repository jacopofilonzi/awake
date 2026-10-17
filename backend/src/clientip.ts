// The client's IP address, for rate limiting and for the address an agent connects from.
//
// Without TRUST_PROXY the socket address is used. Behind a reverse proxy it comes from the header named
// by CLIENT_IP_HEADER (default X-Forwarded-For). For a list header the LAST hop is taken: it is the one
// appended by our own proxy, earlier ones are client-controlled. A single-value header set by the
// proxy (CF-Connecting-IP from Cloudflare, X-Real-IP…) is taken as is; it is trustworthy only if the
// server cannot be reached without going through that proxy.

import type { IncomingHttpHeaders } from "node:http";
import type { Config } from "./config.ts";

export function clientIp(headers: IncomingHttpHeaders, socketIp: string | undefined, config: Pick<Config, "trustProxy" | "clientIpHeader">): string {
  if (config.trustProxy) {
    const raw = headers[config.clientIpHeader];
    const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    const ip = value?.split(",").pop()?.trim();
    if (ip) return ip;
  }
  return socketIp ?? "unknown";
}

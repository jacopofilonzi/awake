// The client IP behind a reverse proxy: which header is read, and which hop of a list.
import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIp } from "../src/clientip.ts";

const xff = { trustProxy: true, clientIpHeader: "x-forwarded-for" };

test("without TRUST_PROXY the socket address is used, headers ignored", () => {
  assert.equal(clientIp({ "x-forwarded-for": "1.2.3.4" }, "10.0.0.1", { trustProxy: false, clientIpHeader: "x-forwarded-for" }), "10.0.0.1");
});

test("X-Forwarded-For: the last hop (added by our proxy), not the client-controlled ones", () => {
  assert.equal(clientIp({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }, "10.0.0.1", xff), "203.0.113.7");
  assert.equal(clientIp({ "x-forwarded-for": " 203.0.113.7 " }, "10.0.0.1", xff), "203.0.113.7");
});

test("a custom header (Cloudflare in front of Traefik): CF-Connecting-IP wins over X-Forwarded-For", () => {
  const headers = { "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "198.51.100.9, 172.70.1.1" };
  assert.equal(clientIp(headers, "10.0.0.1", { trustProxy: true, clientIpHeader: "cf-connecting-ip" }), "198.51.100.9");
});

test("header missing or empty: falls back to the socket address", () => {
  assert.equal(clientIp({}, "10.0.0.1", xff), "10.0.0.1");
  assert.equal(clientIp({ "x-forwarded-for": "" }, "10.0.0.1", xff), "10.0.0.1");
  assert.equal(clientIp({}, undefined, xff), "unknown");
});

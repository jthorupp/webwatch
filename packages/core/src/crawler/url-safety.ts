import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { CrawlerNetworkForTests, ResolvedAddress } from "./types.js";

export function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

export function normalizeCrawlUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Invalid URL.");
  }
  assertHttpUrl(url);
  url.hash = "";
  return url;
}

export function assertHttpUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Only HTTP and HTTPS URLs can be crawled.");
  }
  if (url.username.length > 0 || url.password.length > 0 || url.hostname.length === 0) {
    throw new TypeError("URL credentials and empty hostnames are not allowed.");
  }
}

export async function resolveAndValidate(
  url: URL,
  network: CrawlerNetworkForTests,
  timeoutMs: number,
): Promise<ResolvedAddress[]> {
  assertHttpUrl(url);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isBlockedHostname(hostname)) {
    throw new Error(`Blocked internal network hostname: ${hostname}`);
  }

  const addresses = await withTimeout(network.resolveHost(hostname), timeoutMs, "DNS lookup");
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error(`Blocked non-public network destination: ${hostname}`);
  }
  return addresses;
}

export async function resolvePublicAddresses(hostname: string): Promise<ResolvedAddress[]> {
  const literalFamily = isIP(hostname);
  const addresses = literalFamily === 4 || literalFamily === 6
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const blockedSuffixes = [".localhost", ".local", ".internal", ".home.arpa", ".test", ".invalid", ".onion"];
  return hostname === "localhost" || !hostname.includes(".") || blockedSuffixes.some((suffix) => hostname.endsWith(suffix));
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const value = (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
  const blocked: Array<[string, number]> = [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
    ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
    ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
  ];
  return !blocked.some(([network, prefix]) => ipv4Matches(value, network, prefix));
}

function ipv4Matches(value: number, network: string, prefix: number): boolean {
  const base = network.split(".").map(Number).reduce((result, octet) => result * 256 + octet, 0) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) >>> 0 === (base & mask) >>> 0;
}

function isPublicIpv6(address: string): boolean {
  const words = expandIpv6(address);
  if (words === undefined) return false;
  const first = words[0];
  const second = words[1];
  // Only global unicast space (2000::/3) is eligible for crawling.
  if (first < 0x2000 || first > 0x3fff) return false;
  // Exclude IETF special-purpose, documentation, and 6to4 ranges.
  if (first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) return false;
  if (first === 0x2002) return false;
  if (first === 0x3fff && (words[1] & 0xf000) === 0) return false;
  return true;
}

function expandIpv6(address: string): number[] | undefined {
  let source = address.toLowerCase();
  if (source.includes("%")) return undefined;
  const lastColon = source.lastIndexOf(":");
  const embeddedIpv4 = source.slice(lastColon + 1);
  if (embeddedIpv4.includes(".")) {
    const octets = embeddedIpv4.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
    const firstWord = ((octets[0] << 8) | octets[1]).toString(16);
    const secondWord = ((octets[2] << 8) | octets[3]).toString(16);
    source = `${source.slice(0, lastColon)}:${firstWord}:${secondWord}`;
  }

  const halves = source.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] === "" ? [] : halves[0].split(":");
  const right = halves.length === 1 || halves[1] === "" ? [] : halves[1].split(":");
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return undefined;
  const parts = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  return parts.map((part) => Number.parseInt(part, 16));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs);
    timeout.unref();
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

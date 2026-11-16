import type { LookupAddress, LookupOptions } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { normalizeCrawlUrl, resolveAndValidate } from "./url-safety.js";
import type { CrawlerNetworkForTests, HttpResponse, LoadedPage, ResolvedAddress } from "./types.js";

const MAX_REDIRECTS = 5;

export class ResponseSizeLimitError extends Error {
  constructor(readonly statusCode: number, maxResponseBytes: number) {
    super(`Response exceeded the ${maxResponseBytes} byte limit.`);
    this.name = "ResponseSizeLimitError";
  }
}

export class CrossOriginRedirectBlockedError extends Error {
  readonly code = "cross-origin-redirect-blocked" as const;

  constructor(destinationOrigin: string) {
    super(`Blocked cross-origin redirect to ${destinationOrigin}.`);
    this.name = "CrossOriginRedirectBlockedError";
  }
}

export async function loadPage(
  initialUrl: URL,
  origin: string,
  network: CrawlerNetworkForTests,
  timeoutMs: number,
  maxResponseBytes: number,
  allowCrossOriginRedirects = false,
): Promise<LoadedPage> {
  let url = initialUrl;
  const redirectChain = new Set([url.href]);

  for (let redirectCount = 0; ; redirectCount += 1) {
    const addresses = await resolveAndValidate(url, network, timeoutMs);
    const response = await requestOnce(url, addresses[0], network.lookup, timeoutMs, maxResponseBytes);
    const location = headerValue(response.headers.location);
    if (!isRedirect(response.statusCode) || location === undefined) {
      return { ...response, finalUrl: url.href, redirectsFollowed: redirectCount };
    }
    if (redirectCount >= MAX_REDIRECTS) throw new Error(`Too many redirects (maximum ${MAX_REDIRECTS}).`);

    const nextUrl = normalizeCrawlUrl(new URL(location, url).href);
    if (!allowCrossOriginRedirects && nextUrl.origin !== origin) {
      throw new CrossOriginRedirectBlockedError(nextUrl.origin);
    }
    if (redirectChain.has(nextUrl.href)) throw new Error("Redirect loop detected.");
    // The next iteration resolves and validates this redirect target before connecting.
    redirectChain.add(nextUrl.href);
    url = nextUrl;
  }
}

export function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requestOnce(
  url: URL,
  address: ResolvedAddress,
  injectedLookup: LookupFunction | undefined,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const clientRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
    let settled = false;
    const finish = (error?: Error, response?: HttpResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error !== undefined) reject(error);
      else if (response !== undefined) resolve(response);
    };

    const request = clientRequest(url, {
      method: "GET",
      agent: false,
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "accept-encoding": "identity",
        "user-agent": "WebWatch/0.1 (+https://github.com/jthorupp/webwatch)",
      },
      lookup: injectedLookup ?? pinnedLookup(address),
    }, (response) => {
      const headers = response.headers as Record<string, string | string[] | undefined>;
      if (isRedirect(response.statusCode ?? 0)) {
        finish(undefined, { statusCode: response.statusCode ?? 0, headers, body: "" });
        response.destroy();
        request.destroy();
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > maxResponseBytes) {
          response.destroy();
          request.destroy();
          finish(new ResponseSizeLimitError(response.statusCode ?? 0, maxResponseBytes));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        finish(undefined, {
          statusCode: response.statusCode ?? 0,
          headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
      response.on("error", (error) => finish(error));
    });

    const timeout = setTimeout(() => {
      request.destroy(new Error(`Request timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    timeout.unref();
    request.on("error", (error) => finish(error));
    request.end();
  });
}

function pinnedLookup(address: ResolvedAddress): LookupFunction {
  return ((_hostname: string, options: LookupOptions, callback: (...args: unknown[]) => void) => {
    if (options.all) callback(null, [{ address: address.address, family: address.family } satisfies LookupAddress]);
    else callback(null, address.address, address.family);
  }) as LookupFunction;
}

function isRedirect(statusCode: number): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

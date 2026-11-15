import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, LookupFunction } from "node:net";
import test from "node:test";
import { crawl, crawlWithNetwork, isPublicIpAddress } from "../src/crawler.js";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

async function startServer(handler: Handler): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return { server, port: address.port };
}

function testNetwork(resolveAddress: (call: number) => string = () => "93.184.216.34") {
  let calls = 0;
  const lookup = ((
    _hostname: string,
    options: { all?: boolean },
    callback: (...args: unknown[]) => void,
  ) => {
    if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
    else callback(null, "127.0.0.1", 4);
  }) as LookupFunction;

  return {
    network: {
      resolveHost: async () => [{ address: resolveAddress(++calls), family: 4 as const }],
      lookup,
    },
    resolutionCount: () => calls,
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

test("crawls relative links and skips duplicates, fragments, external and non-HTTP links", async (t) => {
  const requested: string[] = [];
  const { server, port } = await startServer((request, response) => {
    requested.push(request.url ?? "/");
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.url === "/start") {
      response.end(`
        <a href="/about">About</a>
        <a href="./about#details">Duplicate with fragment</a>
        <a href="../contact#top">Contact</a>
        <a href="https://outside.example/page">External</a>
        <a href="mailto:team@example.com">Email</a>
        <a href="#section">Same page</a>
      `);
      return;
    }
    response.end("<p>Done</p>");
  });
  t.after(() => closeServer(server));
  const { network } = testNetwork();

  const result = await crawlWithNetwork(`http://example.com:${port}/start#beginning`, {}, network);

  assert.equal(result.startUrl, `http://example.com:${port}/start`);
  assert.deepEqual(result.discoveredUrls, [
    `http://example.com:${port}/start`,
    `http://example.com:${port}/about`,
    `http://example.com:${port}/contact`,
  ]);
  assert.deepEqual(requested, ["/start", "/about", "/contact"]);
  assert.equal(result.stats.pagesVisited, 3);
  assert.equal(result.stats.linksFound, 6);
  assert.equal(result.stats.duplicateLinksSkipped, 2);
  assert.equal(result.stats.externalLinksSkipped, 2);
});

test("uses a document base URL when resolving relative links", async (t) => {
  const requested: string[] = [];
  const { server, port } = await startServer((request, response) => {
    requested.push(request.url ?? "/");
    response.setHeader("content-type", "text/html");
    response.end(request.url === "/start"
      ? '<base href="/docs/"><a href="guide">Guide</a>'
      : "<p>Guide</p>");
  });
  t.after(() => closeServer(server));
  const { network } = testNetwork();

  const result = await crawlWithNetwork(`http://example.com:${port}/start`, {}, network);

  assert.deepEqual(requested, ["/start", "/docs/guide"]);
  assert.equal(result.discoveredUrls[1], `http://example.com:${port}/docs/guide`);
});

test("does not exceed the configured maxPages limit", async (t) => {
  const requested: string[] = [];
  const { server, port } = await startServer((request, response) => {
    requested.push(request.url ?? "/");
    response.setHeader("content-type", "text/html");
    response.end(request.url === "/"
      ? '<a href="/one">One</a><a href="/two">Two</a><a href="/three">Three</a>'
      : "<p>Page</p>");
  });
  t.after(() => closeServer(server));
  const { network } = testNetwork();

  const result = await crawlWithNetwork(`http://example.com:${port}/`, { maxPages: 2 }, network);

  assert.deepEqual(requested, ["/", "/one"]);
  assert.equal(result.pages.length, 2);
  assert.equal(result.stats.pagesVisited, 2);
  assert.equal(result.stats.uniqueUrlsDiscovered, 4);
});

test("follows same-origin redirects and removes fragments from the final URL", async (t) => {
  const requested: string[] = [];
  const { server, port } = await startServer((request, response) => {
    requested.push(request.url ?? "/");
    if (request.url === "/start") {
      response.writeHead(302, { location: "/destination#fragment" }).end();
      return;
    }
    response.setHeader("content-type", "text/html");
    response.end(request.url === "/destination" ? '<a href="next">Next</a>' : "<p>Done</p>");
  });
  t.after(() => closeServer(server));
  const { network } = testNetwork();

  const result = await crawlWithNetwork(`http://example.com:${port}/start`, {}, network);

  assert.deepEqual(requested, ["/start", "/destination", "/next"]);
  assert.equal(result.pages[0].finalUrl, `http://example.com:${port}/destination`);
  assert.equal(result.stats.redirectsFollowed, 1);
});

test("does not fetch a redirect target a second time when it is already queued", async (t) => {
  const requested: string[] = [];
  const { server, port } = await startServer((request, response) => {
    requested.push(request.url ?? "/");
    if (request.url === "/alias") {
      response.writeHead(302, { location: "/target" }).end();
      return;
    }
    response.setHeader("content-type", "text/html");
    response.end(request.url === "/" ? '<a href="/alias">Alias</a><a href="/target">Target</a>' : "<p>Target</p>");
  });
  t.after(() => closeServer(server));
  const { network } = testNetwork();

  const result = await crawlWithNetwork(`http://example.com:${port}/`, {}, network);

  assert.deepEqual(requested, ["/", "/alias", "/target"]);
  assert.equal(result.stats.pagesVisited, 2);
  assert.ok(result.discoveredUrls.includes(`http://example.com:${port}/target`));
});

test("revalidates each redirect destination before making its request", async (t) => {
  const requested: string[] = [];
  const { server, port } = await startServer((request, response) => {
    requested.push(request.url ?? "/");
    if (request.url === "/start") response.writeHead(302, { location: "/private" }).end();
    else response.end("<p>Must not reach this page</p>");
  });
  t.after(() => closeServer(server));
  const network = testNetwork((call) => call === 3 ? "10.0.0.7" : "93.184.216.34");

  const result = await crawlWithNetwork(`http://example.com:${port}/start`, {}, network.network);

  assert.deepEqual(requested, ["/start"]);
  assert.match(result.pages[0].error ?? "", /Blocked non-public network destination/);
  assert.equal(network.resolutionCount(), 3);
});

test("refuses localhost and private IP destinations by default", async () => {
  await assert.rejects(crawl("http://127.0.0.1/"), /Blocked non-public network destination/);
  await assert.rejects(crawl("http://localhost/"), /Blocked internal network hostname/);
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicIpAddress("10.0.0.1"), false);
  assert.equal(isPublicIpAddress("172.16.0.1"), false);
  assert.equal(isPublicIpAddress("192.168.0.1"), false);
  assert.equal(isPublicIpAddress("169.254.169.254"), false);
  assert.equal(isPublicIpAddress("::1"), false);
  assert.equal(isPublicIpAddress("fc00::1"), false);
});

test("applies the configured request timeout", async (t) => {
  const { server, port } = await startServer((_request, response) => {
    setTimeout(() => response.end("<p>Late response</p>"), 100);
  });
  t.after(() => closeServer(server));
  const { network } = testNetwork();

  const result = await crawlWithNetwork(`http://example.com:${port}/slow`, { timeoutMs: 20 }, network);

  assert.match(result.pages[0].error ?? "", /Request timed out after 20 ms/);
});


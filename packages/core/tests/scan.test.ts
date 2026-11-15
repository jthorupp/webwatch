import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, LookupFunction } from "node:net";
import test from "node:test";
import { scanWithNetwork } from "../src/scan.js";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

async function startServer(handler: Handler): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, port: (server.address() as AddressInfo).port };
}

function network(privateHost?: string) {
  const lookup = ((
    _hostname: string,
    options: { all?: boolean },
    callback: (...args: unknown[]) => void,
  ) => {
    if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
    else callback(null, "127.0.0.1", 4);
  }) as LookupFunction;
  return {
    resolveHost: async (hostname: string) => [{
      address: hostname === privateHost ? "10.0.0.8" : "93.184.216.34",
      family: 4 as const,
    }],
    lookup,
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

test("reports broken internal links, failed assets, and HTTP error responses without repeat fetches", async (t) => {
  const requests = new Map<string, number>();
  const { server, port } = await startServer((request, response) => {
    const path = request.url ?? "/";
    requests.set(path, (requests.get(path) ?? 0) + 1);
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<a href="/gone">gone</a><a href="/failure">failure</a><a href="/denied">denied</a>
        <a href="/shared">shared</a><img src="/good.png"><img src="/gone.png"><img src="/gone.png">
        <link rel="stylesheet" href="/site.css"><script src="/app.js"></script>`);
      return;
    }
    const statusByPath: Record<string, number> = {
      "/gone": 404, "/failure": 500, "/denied": 403,
      "/gone.png": 404, "/site.css": 503, "/app.js": 403,
    };
    response.writeHead(statusByPath[path] ?? 200, {
      "content-type": path === "/shared" ? "application/octet-stream" : "text/html",
    });
    response.end(path === "/good.png" ? "image" : "<p>Done</p>");
  });
  t.after(() => closeServer(server));

  const result = await scanWithNetwork(`http://example.com:${port}/`, {}, network());
  const types = result.findings.map((finding) => finding.type);

  assert.ok(types.includes("broken-internal-link"));
  assert.ok(types.includes("broken-image"));
  assert.ok(types.includes("failed-stylesheet"));
  assert.ok(types.includes("failed-script"));
  assert.deepEqual(
    result.findings.filter((finding) => finding.type === "http-error").map((finding) => finding.evidence.statusCode).sort(),
    [403, 403, 404, 404, 500, 503],
  );
  assert.equal(requests.get("/gone.png"), 1, "duplicate resource URLs should be fetched once");
  assert.equal(requests.get("/shared"), 1, "a resource shared with a crawled link should not be fetched again");
  assert.deepEqual(result.findings, [...result.findings].sort((a, b) => a.url.localeCompare(b.url) || a.type.localeCompare(b.type)));
});

test("bounds concurrent resource checks and blocks private resource destinations", async (t) => {
  let active = 0;
  let maximumActive = 0;
  const requests: string[] = [];
  const { server, port } = await startServer((request, response) => {
    const path = request.url ?? "/";
    requests.push(path);
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end('<img src="/slow-1"><img src="/slow-1"><img src="/slow-2"><img src="/slow-3"><img src="http://private.example/secret.png">');
      return;
    }
    if (path.startsWith("/slow-")) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      setTimeout(() => {
        active -= 1;
        response.end("asset");
      }, 40);
      return;
    }
    response.end("unexpected request");
  });
  t.after(() => closeServer(server));

  const result = await scanWithNetwork(`http://example.com:${port}/`, { concurrency: 2 }, network("private.example"));

  assert.equal(maximumActive, 2);
  assert.equal(requests.filter((path) => path === "/slow-1").length, 1);
  assert.equal(requests.includes("/secret.png"), false);
  const blocked = result.findings.find((finding) => finding.url === "http://private.example/secret.png");
  assert.equal(blocked?.type, "broken-image");
  assert.match(blocked?.evidence.error ?? "", /Blocked non-public network destination/);
});

test("applies request timeouts and response size limits to resource checks", async (t) => {
  const { server, port } = await startServer((request, response) => {
    if (request.url === "/") {
      response.setHeader("content-type", "text/html");
      response.end('<img src="/large"><script src="/slow"></script>');
      return;
    }
    if (request.url === "/slow") {
      setTimeout(() => response.end("late"), 100);
      return;
    }
    response.writeHead(404);
    response.end("x".repeat(100));
  });
  t.after(() => closeServer(server));

  const result = await scanWithNetwork(
    `http://example.com:${port}/`,
    { maxResponseBytes: 64, timeoutMs: 20 },
    network(),
  );
  const large = result.findings.find((finding) => finding.url.endsWith("/large"));
  const slow = result.findings.find((finding) => finding.url.endsWith("/slow"));
  assert.match(large?.evidence.error ?? "", /Response exceeded the 64 byte limit/);
  assert.ok(result.findings.some((finding) => finding.type === "http-error" && finding.evidence.statusCode === 404));
  assert.match(slow?.evidence.error ?? "", /Request timed out after 20 ms/);
});

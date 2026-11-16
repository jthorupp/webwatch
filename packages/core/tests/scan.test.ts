import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP, type AddressInfo, type LookupFunction } from "node:net";
import test from "node:test";
import { compareFindings, scanWithNetwork } from "../src/scan.js";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

async function startServer(handler: Handler): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, port: (server.address() as AddressInfo).port };
}

function network(privateHost?: string, resolver?: (hostname: string, lookupNumber: number) => string) {
  const lookups = new Map<string, number>();
  const lookup = ((
    _hostname: string,
    options: { all?: boolean },
    callback: (...args: unknown[]) => void,
  ) => {
    if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
    else callback(null, "127.0.0.1", 4);
  }) as LookupFunction;
  return {
    resolveHost: async (hostname: string) => {
      const lookupNumber = (lookups.get(hostname) ?? 0) + 1;
      lookups.set(hostname, lookupNumber);
      return [{
        address: isIP(hostname) === 4 || isIP(hostname) === 6
          ? hostname
          : resolver?.(hostname, lookupNumber) ?? (hostname === privateHost ? "10.0.0.8" : "93.184.216.34"),
        family: 4 as const,
      }];
    },
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
  t.after(async () => {
    server.closeAllConnections();
    await closeServer(server);
  });

  const result = await scanWithNetwork(`http://example.com:${port}/`, {}, network());
  const types = result.findings.map((finding) => finding.type);

  assert.ok(types.includes("broken-internal-link"));
  assert.ok(types.includes("broken-image"));
  assert.ok(types.includes("failed-stylesheet"));
  assert.ok(types.includes("failed-script"));
  assert.deepEqual(
    result.findings.filter((finding) => finding.type === "http-error")
      .map((finding) => finding.evidence.statusCode ?? -1).sort((left, right) => left - right),
    [403, 403, 404, 404, 500, 503],
  );
  assert.equal(requests.get("/gone.png"), 1, "duplicate resource URLs should be fetched once");
  assert.equal(requests.get("/shared"), 1, "a resource shared with a crawled link should not be fetched again");
  assert.equal(result.linkChecks.find((check) => check.url.endsWith("/shared"))?.status, "passed");
  assert.equal(result.linkChecks.find((check) => check.url.endsWith("/gone"))?.status, "failed");
  assert.deepEqual(result.findings, [...result.findings].sort(compareFindings));
  assert.equal(result.resourceChecksTruncated, false);
});

test("marks cross-origin navigation redirects unverified without duplicate failure findings", async (t) => {
  const requests: string[] = [];
  const { server, port } = await startServer((request, response) => {
    const path = request.url ?? "/";
    requests.push(path);
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end('<a href="/redirect">Redirect</a><a href="/works">Works</a><a href="/gone">Gone</a>');
      return;
    }
    if (path === "/redirect") {
      response.writeHead(302, { location: "https://other.example/destination" }).end();
      return;
    }
    response.writeHead(path === "/gone" ? 404 : 200, { "content-type": "text/html" }).end("<p>Page</p>");
  });
  t.after(() => closeServer(server));

  const result = await scanWithNetwork(`http://example.com:${port}/`, {}, network());
  const redirectUrl = `http://example.com:${port}/redirect`;
  const redirectFindings = result.findings.filter((finding) => finding.url === redirectUrl);
  const redirectCheck = result.linkChecks.find((check) => check.url === redirectUrl);

  assert.deepEqual(requests, ["/", "/redirect", "/works", "/gone"]);
  assert.equal(redirectFindings.length, 1);
  assert.equal(redirectFindings[0]?.type, "unverified-internal-link");
  assert.equal(redirectFindings[0]?.status, "unverified");
  assert.equal(redirectFindings[0]?.severity, "warning");
  assert.equal(redirectFindings[0]?.evidence.reason, "cross-origin-redirect-blocked");
  assert.equal(redirectCheck?.status, "unverified");
  assert.equal(redirectCheck?.reason, "cross-origin-redirect-blocked");
  assert.equal(result.findings.some((finding) =>
    finding.url === redirectUrl && (finding.type === "http-error" || finding.type === "broken-internal-link")), false);
  assert.equal(result.linkChecks.find((check) => check.url.endsWith("/works"))?.status, "passed");
  assert.equal(result.linkChecks.find((check) => check.url.endsWith("/gone"))?.status, "failed");
  assert.ok(result.findings.some((finding) =>
    finding.url.endsWith("/gone") && finding.type === "broken-internal-link" && finding.status === "failed"));
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

test("checks public cross-origin resources and follows safe cross-origin resource redirects", async (t) => {
  const requests: string[] = [];
  const { server, port } = await startServer((request, response) => {
    const path = request.url ?? "/";
    const host = request.headers.host ?? "";
    requests.push(`${host}${path}`);
    if (host.startsWith("example.com") && path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<a href="http://outside.example.org:${port}/navigation">external navigation</a>
        <img src="http://cdn.example.org:${port}/image.png">
        <link rel="stylesheet" href="http://cdn.example.org:${port}/site.css">
        <script src="http://cdn.example.org:${port}/redirect-script"></script>`);
      return;
    }
    if (path === "/redirect-script") {
      response.writeHead(302, { location: `http://static.example.net:${port}/script.js` }).end();
      return;
    }
    response.end("asset");
  });
  t.after(() => closeServer(server));

  const result = await scanWithNetwork(`http://example.com:${port}/`, {}, network());

  assert.ok(requests.includes(`cdn.example.org:${port}/image.png`));
  assert.ok(requests.includes(`cdn.example.org:${port}/site.css`));
  assert.ok(requests.includes(`cdn.example.org:${port}/redirect-script`));
  assert.ok(requests.includes(`static.example.net:${port}/script.js`));
  assert.equal(requests.some((request) => request.includes("outside.example.org")), false);
  assert.deepEqual(result.findings, []);
});

test("blocks private resource destinations and revalidates redirect destinations", async (t) => {
  const requests: string[] = [];
  const { server, port } = await startServer((request, response) => {
    const path = request.url ?? "/";
    requests.push(path);
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<img src="http://10.0.0.8:${port}/private-ip">
        <img src="http://private.example.org:${port}/private-dns">
        <img src="http://cdn.example.org:${port}/redirect-private">`);
      return;
    }
    if (path === "/redirect-private") {
      response.writeHead(302, { location: `http://10.0.0.9:${port}/private-redirect-target` }).end();
      return;
    }
    response.end("unexpected request");
  });
  t.after(async () => {
    server.closeAllConnections();
    await closeServer(server);
  });

  const result = await scanWithNetwork(`http://example.com:${port}/`, {}, network("private.example.org"));

  assert.equal(requests.includes("/private-ip"), false);
  assert.equal(requests.includes("/private-dns"), false);
  assert.equal(requests.includes("/private-redirect-target"), false);
  assert.equal(result.findings.filter((finding) => finding.type === "broken-image").length, 3);
  assert.ok(result.findings.every((finding) => /Blocked|redirect/i.test(finding.evidence.error ?? "")));
});

test("re-resolves a public cross-origin resource before following its redirect", async (t) => {
  const requests: string[] = [];
  const { server, port } = await startServer((request, response) => {
    const path = request.url ?? "/";
    requests.push(path);
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<img src="http://cdn.example.org:${port}/redirect">`);
      return;
    }
    if (path === "/redirect") {
      response.writeHead(302, { location: "/redirect-target" }).end();
      return;
    }
    response.end("must not fetch after DNS changes");
  });
  t.after(() => closeServer(server));
  const resolver = (hostname: string, lookupNumber: number): string =>
    hostname === "cdn.example.org" && lookupNumber > 1 ? "10.0.0.7" : "93.184.216.34";

  const result = await scanWithNetwork(`http://example.com:${port}/`, {}, network(undefined, resolver));

  assert.equal(requests.includes("/redirect-target"), false);
  const finding = result.findings.find((item) => item.type === "broken-image");
  assert.match(finding?.evidence.error ?? "", /Blocked non-public network destination/);
});

test("reports crawled page network failures and timeouts as http-error findings", async (t) => {
  const { server, port } = await startServer((request, response) => {
    if (request.url === "/") {
      response.setHeader("content-type", "text/html");
      response.end('<a href="/disconnect">disconnect</a><a href="/timeout">timeout</a>');
      return;
    }
    if (request.url === "/disconnect") {
      response.destroy();
      return;
    }
  });
  t.after(async () => {
    server.closeAllConnections();
    await closeServer(server);
  });

  const result = await scanWithNetwork(`http://example.com:${port}/`, { timeoutMs: 25 }, network());
  const disconnectedUrl = `http://example.com:${port}/disconnect`;
  const timeoutUrl = `http://example.com:${port}/timeout`;
  const disconnected = result.findings.find((finding) => finding.type === "http-error" && finding.url === disconnectedUrl);
  const timedOut = result.findings.find((finding) => finding.type === "http-error" && finding.url === timeoutUrl);

  assert.equal(disconnected?.evidence.statusCode, undefined);
  assert.match(disconnected?.evidence.error ?? "", /socket hang up|reset/i);
  assert.equal(timedOut?.evidence.statusCode, undefined);
  assert.match(timedOut?.evidence.error ?? "", /Request timed out after 25 ms/);
  assert.equal(result.linkChecks.find((check) => check.url === disconnectedUrl)?.status, "failed");
  assert.equal(result.linkChecks.find((check) => check.url === timeoutUrl)?.status, "failed");
});

test("marks resource checks incomplete when the target safety limit truncates them", async (t) => {
  const requests: string[] = [];
  const { server, port } = await startServer((request, response) => {
    const path = request.url ?? "/";
    requests.push(path);
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end('<img src="/one"><img src="/two"><img src="/three">');
      return;
    }
    response.end("asset");
  });
  t.after(() => closeServer(server));

  const result = await scanWithNetwork(`http://example.com:${port}/`, { maxPages: 1 }, network(), 2);

  assert.equal(result.resourceChecksTruncated, true);
  assert.equal(requests.includes("/three"), false);
  assert.equal(requests.filter((path) => path !== "/").length, 2);
});

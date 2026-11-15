export const version = "0.1.0";

export { crawl, isPublicIpAddress } from "./crawler.js";
export type { CrawlOptions, CrawlPage, CrawlResult, CrawlStats } from "./crawler.js";

export type WebWatchCommand =
  | { name: "help" }
  | { name: "version" }
  | { name: "init" }
  | { name: "scan"; url: string; maxPages?: number };

export type ParseResult =
  | { command: WebWatchCommand }
  | { error: string };

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0;
  } catch {
    return false;
  }
}

export function parseCommand(args: string[]): ParseResult {
  const [first, second, ...extra] = args;

  if (args.length === 0 || first === "--help" || first === "-h") {
    return { command: { name: "help" } };
  }
  if (first === "--version" || first === "-v") {
    return { command: { name: "version" } };
  }
  if (first === "init") {
    return extra.length === 0 && second === undefined
      ? { command: { name: "init" } }
      : { error: "init does not accept arguments." };
  }
  if (first === "scan") {
    if (second === undefined) {
      return { error: "Usage: webwatch scan <url> [--max-pages <number>]" };
    }
    if (!isValidHttpUrl(second)) {
      return { error: "Invalid URL. Use an absolute http:// or https:// URL without credentials." };
    }
    if (extra.length === 0) return { command: { name: "scan", url: second } };
    if (extra.length !== 2 || extra[0] !== "--max-pages") {
      return { error: "Usage: webwatch scan <url> [--max-pages <number>]" };
    }
    const maxPages = Number(extra[1]);
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1_000) {
      return { error: "--max-pages must be an integer from 1 to 1000." };
    }
    return { command: { name: "scan", url: second, maxPages } };
  }

  return { error: `Unknown command: ${first}` };
}

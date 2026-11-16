export const version = "0.1.0";

export { crawl, isPublicIpAddress } from "./crawler.js";
export type { CrawlOptions, CrawlPage, CrawlResult, CrawlStats } from "./crawler.js";
export { scan } from "./scan.js";
export type { ScanOptions, ScanResult } from "./scan.js";
export type { Finding, FindingEvidence, FindingSeverity, FindingType } from "./finding.js";

export type WebWatchCommand =
  | { name: "help" }
  | { name: "version" }
  | { name: "init" }
  | { name: "scan"; url: string; maxPages?: number; concurrency?: number; format?: "json" };

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
      return { error: scanUsage() };
    }
    if (!isValidHttpUrl(second)) {
      return { error: "Invalid URL. Use an absolute http:// or https:// URL without credentials." };
    }
    const command: Extract<WebWatchCommand, { name: "scan" }> = { name: "scan", url: second };
    for (let index = 0; index < extra.length; index += 2) {
      const option = extra[index];
      const value = extra[index + 1];
      if (value === undefined || (option !== "--max-pages" && option !== "--concurrency")) {
        if (option !== "--format") return { error: scanUsage() };
      }
      if (option === "--format") {
        if (command.format !== undefined) return { error: "--format may only be specified once." };
        if (value !== "json") return { error: "--format only supports json." };
        command.format = "json";
        continue;
      }
      if (value === undefined) return { error: scanUsage() };
      const number = Number(value);
      if (option === "--max-pages") {
        if (command.maxPages !== undefined) return { error: "--max-pages may only be specified once." };
        if (!Number.isSafeInteger(number) || number < 1 || number > 1_000) {
          return { error: "--max-pages must be an integer from 1 to 1000." };
        }
        command.maxPages = number;
      } else {
        if (command.concurrency !== undefined) return { error: "--concurrency may only be specified once." };
        if (!Number.isSafeInteger(number) || number < 1 || number > 32) {
          return { error: "--concurrency must be an integer from 1 to 32." };
        }
        command.concurrency = number;
      }
    }
    return { command };
  }

  return { error: `Unknown command: ${first}` };
}

function scanUsage(): string {
  return "Usage: webwatch scan <url> [--max-pages <number>] [--concurrency <number>] [--format json]";
}

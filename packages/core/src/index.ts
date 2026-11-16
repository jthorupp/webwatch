export const version = "0.1.0";

export { crawl, isPublicIpAddress } from "./crawler.js";
export type { CrawlOptions, CrawlPage, CrawlResult, CrawlStats } from "./crawler.js";
export { scan } from "./scan.js";
export type { ScanOptions, ScanResult } from "./scan.js";
export type {
  Finding,
  FindingEvidence,
  FindingSeverity,
  FindingStatus,
  FindingType,
  LinkCheck,
  LinkCheckReason,
  LinkCheckStatus,
} from "./finding.js";

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
    const seenOptions = new Set<string>();
    for (let index = 0; index < extra.length; index += 1) {
      const option = extra[index];
      if (option !== "--format" && option !== "--max-pages" && option !== "--concurrency") {
        return { error: scanUsage() };
      }
      if (seenOptions.has(option)) return { error: `${option} may only be specified once.` };
      seenOptions.add(option);

      const value = extra[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { error: option === "--format" ? "--format requires a value: json." : `${option} requires a value.` };
      }

      if (option === "--format") {
        if (value !== "json") return { error: "--format only supports json." };
        command.format = "json";
        index += 1;
        continue;
      }
      const number = Number(value);
      if (option === "--max-pages") {
        if (!Number.isSafeInteger(number) || number < 1 || number > 1_000) {
          return { error: "--max-pages must be an integer from 1 to 1000." };
        }
        command.maxPages = number;
      } else {
        if (!Number.isSafeInteger(number) || number < 1 || number > 32) {
          return { error: "--concurrency must be an integer from 1 to 32." };
        }
        command.concurrency = number;
      }
      index += 1;
    }
    return { command };
  }

  return { error: `Unknown command: ${first}` };
}

function scanUsage(): string {
  return "Usage: webwatch scan <url> [--max-pages <number>] [--concurrency <number>] [--format json]";
}

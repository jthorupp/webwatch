export const version = "0.1.0";

export type WebWatchCommand =
  | { name: "help" }
  | { name: "version" }
  | { name: "init" }
  | { name: "scan"; url: string };

export type ParseResult =
  | { command: WebWatchCommand }
  | { error: string };

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
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
    if (second === undefined || extra.length > 0) {
      return { error: "Usage: webwatch scan <url>" };
    }
    if (!isValidHttpUrl(second)) {
      return { error: `Invalid URL: ${second}. Use an absolute http:// or https:// URL.` };
    }
    return { command: { name: "scan", url: second } };
  }

  return { error: `Unknown command: ${first}` };
}

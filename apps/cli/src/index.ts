#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCommand, scan, version } from "@webwatch/core";
import { formatScanReport, getScanExitCode } from "./report.js";

const helpText = `WebWatch ${version}

Usage:
  webwatch <command> [options]

Commands:
  init                 Create a minimal webwatch.config.ts
  scan <url>           Crawl pages and check HTTP resources
                       [--max-pages <number>] (default: 100)
                       [--concurrency <number>] (default: 4)

Options:
  -h, --help           Show this help
  -v, --version        Show the version`;

async function main(): Promise<void> {
  const result = parseCommand(process.argv.slice(2));
  if ("error" in result) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  switch (result.command.name) {
    case "help":
      console.log(helpText);
      return;
    case "version":
      console.log(`WebWatch ${version}`);
      return;
    case "init": {
      const configPath = join(process.cwd(), "webwatch.config.ts");
      try {
        await writeFile(configPath, "export default {};\n", { flag: "wx" });
        console.log(`Created ${configPath}`);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
          console.error("webwatch.config.ts already exists; leaving it unchanged.");
        } else {
          throw error;
        }
        process.exitCode = 1;
      }
      return;
    }
    case "scan": {
      const scanResult = await scan(result.command.url, {
        maxPages: result.command.maxPages,
        concurrency: result.command.concurrency,
      });
      console.log(formatScanReport(scanResult));
      process.exitCode = getScanExitCode(scanResult);
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

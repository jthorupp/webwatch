import type { ScanOptions, ScanResult } from "@webwatch/core";
import { scan } from "@webwatch/core";
import { formatScanJson, formatScanReport, getScanExitCode } from "./report.js";

export interface ScanCommandOutput {
  stdout(message: string): void;
  stderr(message: string): void;
}

type ScanOperation = (url: string, options: ScanOptions) => Promise<ScanResult>;

export async function runScanCommand(
  url: string,
  options: ScanOptions,
  format: "json" | undefined,
  output: ScanCommandOutput,
  scanOperation: ScanOperation = scan,
): Promise<0 | 1 | 2> {
  try {
    const result = await scanOperation(url, options);
    output.stdout(format === "json" ? formatScanJson(result) : formatScanReport(result));
    return getScanExitCode(result);
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

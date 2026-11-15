export type FindingType =
  | "broken-internal-link"
  | "broken-image"
  | "failed-stylesheet"
  | "failed-script"
  | "http-error";

export type FindingSeverity = "error";

export interface FindingEvidence {
  statusCode?: number;
  sourceUrls: string[];
  error?: string;
}

export interface Finding {
  id: string;
  type: FindingType;
  severity: FindingSeverity;
  url: string;
  message: string;
  evidence: FindingEvidence;
}

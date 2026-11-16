export type FindingType =
  | "broken-internal-link"
  | "unverified-internal-link"
  | "broken-image"
  | "failed-stylesheet"
  | "failed-script"
  | "http-error";

export type FindingSeverity = "error" | "warning";

export type FindingStatus = "failed" | "unverified";
export type LinkCheckStatus = FindingStatus | "passed";
export type LinkCheckReason = "cross-origin-redirect-blocked";

export interface FindingEvidence {
  statusCode?: number;
  sourceUrls: string[];
  error?: string;
  reason?: LinkCheckReason;
}

export interface Finding {
  id: string;
  type: FindingType;
  severity: FindingSeverity;
  status: FindingStatus;
  url: string;
  message: string;
  evidence: FindingEvidence;
}

export interface LinkCheck {
  url: string;
  sourceUrls: string[];
  status: LinkCheckStatus;
  reason?: LinkCheckReason;
  statusCode?: number;
  error?: string;
}

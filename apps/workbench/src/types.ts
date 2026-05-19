export type StatusResponse = {
  schemaVersion?: string;
  app: string;
  version: string;
  ready: boolean;
  checks: ReadonlyArray<{
    name: string;
    ready: boolean;
    detail: string;
    required?: boolean;
    state?: string | null;
  }>;
};

export type ReviewType = "proofread" | "consistency" | "compare";

export type PdfReviewJobResponse = {
  schemaVersion: "RelayPdfReviewJob.v1";
  jobId: string;
  status: "completed" | "partial" | "cancelled" | "failed" | string;
  reviewType: ReviewType;
  createdAt: string;
  documents: PdfReviewDocument[];
  findings: PdfReviewFinding[];
  limitations: string[];
  reportMarkdown: string;
};

export type PdfReviewDocument = {
  documentId: string;
  displayName: string;
  sha256: string;
  pageCount: number;
  pages: PdfReviewPage[];
  warnings: string[];
  extractionTruncated: boolean;
};

export type PdfReviewPage = {
  page: number;
  charCount: number;
  preview: string;
  hasText: boolean;
};

export type PdfReviewFinding = {
  id: string;
  reviewType: ReviewType;
  severity: "info" | "low" | "medium" | "high" | string;
  category: string;
  documentId: string;
  page: number;
  anchor: string;
  evidence: string;
  issue: string;
  suggestion: string;
  confidence: "low" | "medium" | "high" | string;
  status: string;
  comparedDocumentId?: string | null;
  comparedPage?: number | null;
  comparedEvidence?: string | null;
};

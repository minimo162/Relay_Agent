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

export type ReviewType = "auto" | "single-document" | "multi-document" | "proofread" | "consistency" | "compare";

export type PdfReviewJobResponse = {
  schemaVersion: "RelayPdfReviewJob.v1";
  jobId: string;
  status: "completed" | "partial" | "cancelled" | "failed" | string;
  reviewType: ReviewType;
  createdAt: string;
  documents: PdfReviewDocument[];
  findings: PdfReviewFinding[];
  sectionAlignments: PdfReviewSectionAlignment[];
  limitations: string[];
  reportMarkdown: string;
};

export type PdfReviewDocument = {
  documentId: string;
  displayName: string;
  sha256: string;
  pageCount: number;
  pages: PdfReviewPage[];
  sections: PdfReviewSection[];
  warnings: string[];
  extractionTruncated: boolean;
};

export type PdfReviewPage = {
  page: number;
  charCount: number;
  preview: string;
  hasText: boolean;
};

export type PdfReviewSection = {
  sectionId: string;
  title: string;
  startPage: number;
  endPage: number;
  preview: string;
  charCount: number;
};

export type PdfReviewSectionAlignment = {
  alignmentId: string;
  baseDocumentId: string;
  baseSectionId: string;
  baseTitle: string;
  basePageStart: number;
  basePageEnd: number;
  comparedDocumentId: string;
  comparedSectionId?: string | null;
  comparedTitle?: string | null;
  comparedPageStart?: number | null;
  comparedPageEnd?: number | null;
  score: number;
  status: "aligned" | "low_confidence" | "unmatched_base" | "unmatched_compared" | string;
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

/**
 * Folder-role classifier for Relay Document Search.
 *
 * This is metadata-only. It helps AionUi explain why a candidate lives in a
 * filing/output/audit/backup/work folder without changing filesystem state.
 */

export const RELAY_DOCUMENT_SEARCH_FOLDER_ROLES_CONTRACT = 'RelayDocumentSearchFolderRoles.v1' as const;

export type RelayDocumentSearchFolderRole =
  | 'filing'
  | 'output'
  | 'audit'
  | 'backup'
  | 'work'
  | 'source'
  | 'review';

export type RelayDocumentSearchFolderRoleMatch = {
  role: RelayDocumentSearchFolderRole;
  segment: string;
  confidence: 'high' | 'medium';
  reason: string;
};

export type RelayDocumentSearchFolderRoleReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_FOLDER_ROLES_CONTRACT;
  primaryRole?: RelayDocumentSearchFolderRole;
  roles: RelayDocumentSearchFolderRoleMatch[];
};

const ROLE_PATTERNS: Array<{
  role: RelayDocumentSearchFolderRole;
  reason: string;
  terms: string[];
}> = [
  {
    role: 'backup',
    reason: 'backup_path_segment',
    terms: ['backup', 'back up', 'bak', 'old', 'archive', '履歴', '過去', 'バックアップ', '旧', '退避'],
  },
  {
    role: 'filing',
    reason: 'filing_path_segment',
    terms: ['filing', 'filed', 'xsa', '提出済', '提出用', 'ファイリング', '保管', '保存', '開示'],
  },
  {
    role: 'audit',
    reason: 'audit_path_segment',
    terms: ['audit', 'auditor', '監査', '会計士', '監査等委員会', '監査法人'],
  },
  {
    role: 'output',
    reason: 'output_path_segment',
    terms: ['output', 'out', 'export', 'final', '提出', '出力', '最終', '完成', '納品'],
  },
  {
    role: 'work',
    reason: 'work_path_segment',
    terms: ['work', 'working', 'workpaper', 'draft', '作業', '作成', 'ドラフト', 'tmp', 'temp'],
  },
  {
    role: 'source',
    reason: 'source_path_segment',
    terms: ['source', 'input', 'raw', 'sap', 'pkg', '元データ', '取込', 'インプット', '入力'],
  },
  {
    role: 'review',
    reason: 'review_path_segment',
    terms: ['review', 'check', 'confirm', 'レビュー', '確認', '検証', 'チェック'],
  },
];

const ROLE_PRIORITY: RelayDocumentSearchFolderRole[] = [
  'work',
  'source',
  'output',
  'audit',
  'filing',
  'review',
  'backup',
];

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\\/_\-.()[\]{}【】（）]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function pathSegments(displayPath: string): string[] {
  return displayPath
    .replace(/\\/gu, '/')
    .split('/')
    .slice(0, -1)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function rolePriority(role: RelayDocumentSearchFolderRole): number {
  const index = ROLE_PRIORITY.indexOf(role);
  return index >= 0 ? index : ROLE_PRIORITY.length;
}

export function classifyRelayDocumentSearchFolderRoles(displayPath: string): RelayDocumentSearchFolderRoleReport {
  const matches: RelayDocumentSearchFolderRoleMatch[] = [];
  for (const segment of pathSegments(displayPath)) {
    const normalizedSegment = normalize(segment);
    if (!normalizedSegment) continue;
    for (const pattern of ROLE_PATTERNS) {
      const matchedTerm = pattern.terms.find((term) => normalizedSegment.includes(normalize(term)));
      if (!matchedTerm) continue;
      if (matches.some((match) => match.role === pattern.role && match.segment === segment)) continue;
      matches.push({
        role: pattern.role,
        segment,
        confidence: normalizedSegment === normalize(matchedTerm) ? 'high' : 'medium',
        reason: pattern.reason,
      });
    }
  }
  const roles = matches.sort((left, right) => rolePriority(left.role) - rolePriority(right.role));
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_FOLDER_ROLES_CONTRACT,
    primaryRole: roles[0]?.role,
    roles,
  };
}

export function summarizeRelayDocumentSearchFolderRoles(
  reports: RelayDocumentSearchFolderRoleReport[],
): Record<RelayDocumentSearchFolderRole, number> {
  const out = {
    filing: 0,
    output: 0,
    audit: 0,
    backup: 0,
    work: 0,
    source: 0,
    review: 0,
  };
  for (const report of reports) {
    if (!report.primaryRole) continue;
    out[report.primaryRole] += 1;
  }
  return out;
}

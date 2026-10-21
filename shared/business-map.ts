export type BusinessMapSourceId = 'platform' | 'wecom';
export type BusinessMapRecordStatus = 'ready' | 'not_connected' | 'not_read';

export type BusinessMapColumn = {
  key: string;
  label: string;
};

export type BusinessMapSource = {
  id: BusinessMapSourceId;
  label: string;
  available: boolean;
};

export type BusinessMapEntity = {
  code: string;
  name: string;
  columns: BusinessMapColumn[];
  sources: BusinessMapSource[];
};

export type BusinessMapGroup = {
  id: string;
  name: string;
  path: [string, string, string, string];
  entities: BusinessMapEntity[];
};

/** Read-only business-view catalog. It does not alter ontology definitions or grant data access. */
export type BusinessMapCatalog = {
  context: {
    companyId: string;
    companies: { id: string; name: string }[];
    admin: boolean;
  };
  groups: BusinessMapGroup[];
};

export type BusinessMapRecordField = {
  key: string;
  label: string;
  value: string | null;
  layout: 'compact' | 'long';
  width?: 'small' | 'medium' | 'wide';
};

export type BusinessMapRecordLink = {
  label: string;
  entityCode: string;
  /** Opaque attribution filter for a relationship view; never an internal database ID. */
  unit?: string;
};

export type BusinessMapRecord = {
  /** Opaque, stable only within its company/entity/source reading context. */
  id: string;
  values: Record<string, string | null>;
  fields: BusinessMapRecordField[];
  links?: BusinessMapRecordLink[];
};

/** Read-only records response. Historic WeCom previews are explicitly not imported snapshots. */
export type BusinessMapRecords = {
  companyId: string;
  entityCode: string;
  source: BusinessMapSourceId;
  sourceLabel: string;
  status: BusinessMapRecordStatus;
  note: string;
  /** Source synchronization/publication time in normalized ISO UTC; never local preview-save time. */
  observedAt: string | null;
  records: BusinessMapRecord[];
  total: number | null;
  page: number;
  pageSize: number;
};

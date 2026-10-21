import type {
  BusinessMapCatalog as SharedBusinessMapCatalog,
  BusinessMapColumn as SharedBusinessMapColumn,
  BusinessMapEntity as SharedBusinessMapEntity,
  BusinessMapGroup as SharedBusinessMapGroup,
  BusinessMapRecord as SharedBusinessMapRecord,
  BusinessMapRecordField as SharedBusinessMapRecordField,
  BusinessMapRecords as SharedBusinessMapRecords,
  BusinessMapSource as SharedBusinessMapSource,
  BusinessMapSourceId as SharedBusinessMapSourceId,
} from "../../../../shared/business-map.js";

export type BusinessMapSourceId = SharedBusinessMapSourceId;

export type BusinessMapCompany = {
  id: string;
  name: string;
};

export type BusinessMapColumn = SharedBusinessMapColumn;
export type BusinessMapSource = SharedBusinessMapSource;
export type BusinessMapEntity = SharedBusinessMapEntity;
export type BusinessMapGroup = SharedBusinessMapGroup;
export type BusinessMapCatalog = SharedBusinessMapCatalog;
export type BusinessMapRecordField = SharedBusinessMapRecordField;
export type BusinessMapRecord = SharedBusinessMapRecord;
export type BusinessMapRecords = SharedBusinessMapRecords;

export type BusinessMapRecordQuery = {
  companyId: string;
  entityCode: string;
  source: BusinessMapSourceId;
  page: number;
  pageSize: number;
  q?: string;
  unit?: string;
};

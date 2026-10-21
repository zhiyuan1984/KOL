import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BusinessMapRequestError, getBusinessMapCatalog, getBusinessMapRecords } from "./api";
import { Select } from "antd";
import {
  BUSINESS_MAP_PAGE_SIZE,
  companyOptions,
  detailFields,
  filterCatalog,
  formatSourceTime,
  parseIndexList,
  recordScopeKey,
  selectedEntity,
  selectedSource,
  serializeIndexList,
  sourceStatus,
  textValue,
} from "./model";
import type { BusinessMapCatalog, BusinessMapEntity, BusinessMapRecord, BusinessMapRecordField, BusinessMapRecords } from "./types";
import "./BusinessMapWorkspace.css";

type RecordSnapshot = { scope: string; data: BusinessMapRecords };
type ParameterPatch = Record<string, string | null | undefined>;

function numericParam(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function browserCompanyPreference(): string {
  if (typeof window === "undefined") return "";
  try { return window.localStorage.getItem("business-map.company") || ""; } catch { return ""; }
}

function persistCompanyPreference(companyId: string): void {
  try { window.localStorage.setItem("business-map.company", companyId); } catch { /* Storage is only a convenience. */ }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function LongField({ field }: { field: BusinessMapRecordField }) {
  const valueRef = useRef<HTMLSpanElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [overflowed, setOverflowed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const element = valueRef.current;
    const probe = probeRef.current;
    if (!element || !probe) return;
    const measure = () => {
      const hasHardLineBreak = /\r?\n/.test(field.value || "");
      const exceedsOneLine = probe.scrollWidth > element.clientWidth + 1;
      const needsToggle = hasHardLineBreak || exceedsOneLine;
      setOverflowed(needsToggle);
      if (!needsToggle) setExpanded(false);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [field.value]);

  const value = textValue(field.value);
  return (
    <div className="business-map-long-field" data-long-field data-expanded={expanded}>
      <span className="business-map-field-label">{field.label}：</span>
      <span className="business-map-long-preview" ref={valueRef}>{value}</span>
      <span className="business-map-long-probe" aria-hidden="true" ref={probeRef}>{value}</span>
      {overflowed && (
        <button
          type="button"
          className="business-map-text-button"
          data-business-map-long-toggle
          aria-expanded={expanded}
          onClick={(event) => { event.stopPropagation(); setExpanded((current) => !current); }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {expanded ? "收起" : "展开"}
        </button>
      )}
    </div>
  );
}

function RecordRow({
  record,
  index,
  entity,
  expanded,
  onToggle,
  onFollowLink,
}: {
  record: BusinessMapRecord;
  index: number;
  entity: BusinessMapEntity;
  expanded: boolean;
  onToggle: (index: number) => void;
  onFollowLink: (entityCode: string, unit?: string) => void;
}) {
  const summaryKeys = useMemo(() => new Set(entity.columns.map((column) => column.key)), [entity.columns]);
  const fields = detailFields(record, summaryKeys);
  const compact = fields.filter((field) => field.layout === "compact");
  const long = fields.filter((field) => field.layout === "long");

  return (
    <div className="business-map-record-row">
      <div className="business-map-record-summary">
        <button
          type="button"
          className="business-map-record-expand"
          aria-label={`${expanded ? "收起" : "展开"}记录详情`}
          aria-expanded={expanded}
          onClick={() => onToggle(index)}
        >
          <span className="business-map-chevron" data-expanded={expanded}>›</span>
        </button>
        {entity.columns.map((column) => (
          <span className="business-map-record-value" title={textValue(record.values[column.key])} key={column.key}>{textValue(record.values[column.key])}</span>
        ))}
      </div>
      {expanded && (
        <div className="business-map-record-detail">
          {compact.length > 0 && (
            <div className="business-map-field-flow" data-business-map-compact-fields>
              {compact.map((field) => (
                <span className="business-map-compact-field" data-width={field.width || "medium"} key={field.key}>
                  <span className="business-map-field-label">{field.label}：</span>
                  <span className="business-map-field-value" tabIndex={0} aria-label={`${field.label}：${textValue(field.value)}`} title={textValue(field.value)}>{textValue(field.value)}</span>
                </span>
              ))}
            </div>
          )}
          {long.map((field) => <LongField field={field} key={field.key} />)}
          {!!record.links?.length && (
            <div className="business-map-links" aria-label="关联记录">
              {record.links.map((link, linkIndex) => (
                <button
                  type="button"
                  className="business-map-link"
                  key={`${link.entityCode}-${linkIndex}`}
                  onClick={(event) => { event.stopPropagation(); onFollowLink(link.entityCode, link.unit); }}
                >
                  {link.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BusinessMapWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const preferredCompany = useMemo(browserCompanyPreference, []);
  const [catalog, setCatalog] = useState<BusinessMapCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [records, setRecords] = useState<RecordSnapshot | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [recordsForbidden, setRecordsForbidden] = useState(false);
  const [recordsRetry, setRecordsRetry] = useState(0);
  const catalogSequence = useRef(0);
  const recordSequence = useRef(0);
  const recordIdentity = useRef<{ scope: string; value: string } | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const recordsRef = useRef<HTMLElement>(null);
  const [availableHeight, setAvailableHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      if (window.innerWidth <= 1100) { setAvailableHeight(null); return; }
      const parentPadding = element.parentElement ? Number.parseFloat(getComputedStyle(element.parentElement).paddingBottom) || 0 : 0;
      setAvailableHeight(Math.max(0, window.innerHeight - element.getBoundingClientRect().top - parentPadding));
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", schedule); };
  }, []);

  const patchParams = (patch: ParameterPatch) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      Object.entries(patch).forEach(([key, value]) => {
        if (value === undefined) return;
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      });
      return next;
    });
  };

  const companyParam = searchParams.get("companyId") || preferredCompany;
  const entityCode = searchParams.get("entity") || "";
  const source = searchParams.get("source") || "";
  const catalogSearch = searchParams.get("catalogQ") || "";
  const domains = (searchParams.get("domains") || "").split(",").filter(Boolean);
  const recordQuery = searchParams.get("q") || "";
  const unit = searchParams.get("unit") || "";
  const page = numericParam(searchParams.get("page"), 1);
  const openObjectIds = new Set((searchParams.get("objects") || "").split(",").filter(Boolean));
  const expandedRecords = parseIndexList(searchParams.get("expanded"));

  useEffect(() => {
    const controller = new AbortController();
    const request = ++catalogSequence.current;
    setCatalogLoading(true);
    setCatalogError("");
    void getBusinessMapCatalog(companyParam || undefined, controller.signal)
      .then((response) => {
        if (request !== catalogSequence.current) return;
        setCatalog(response);
      })
      .catch((error: unknown) => {
        if (isAbort(error) || request !== catalogSequence.current) return;
        setCatalogError(error instanceof BusinessMapRequestError ? error.message : "目录暂时无法读取，请重试");
        setCatalog(null);
      })
      .finally(() => {
        if (request === catalogSequence.current) setCatalogLoading(false);
      });
    return () => controller.abort();
  }, [companyParam, catalogRetry]);

  const chosen = selectedEntity(catalog, entityCode);
  const currentCompanyId = companyParam || catalog?.context.companyId || "";
  const activeSource = selectedSource(chosen?.entity, source);
  const scope = recordScopeKey(currentCompanyId, entityCode, source, recordQuery, unit, page);

  useEffect(() => {
    if (!catalog || !entityCode) return;
    if (!chosen) patchParams({ entity: null, source: null, q: null, unit: null, page: null, expanded: null });
  }, [catalog, chosen?.entity.code, entityCode]);

  useEffect(() => {
    if (!chosen || source) return;
    patchParams({ source: chosen.entity.sources[0]?.id || null, page: "1", expanded: null });
  }, [chosen?.entity, source]);

  useEffect(() => {
    if (!chosen || !currentCompanyId || !activeSource) {
      setRecords(null);
      setRecordsLoading(false);
      setRecordsError("");
      setRecordsForbidden(false);
      return;
    }
    const controller = new AbortController();
    const request = ++recordSequence.current;
    setRecordsLoading(true);
    setRecordsError("");
    setRecordsForbidden(false);
    setRecords((current) => current?.scope === scope ? current : null);
    void getBusinessMapRecords({
      companyId: currentCompanyId,
      entityCode: chosen.entity.code,
      source: activeSource.id,
      page,
      pageSize: BUSINESS_MAP_PAGE_SIZE,
      q: recordQuery || undefined,
      unit: unit || undefined,
    }, controller.signal)
      .then((response) => {
        if (request !== recordSequence.current) return;
        setRecords({ scope, data: response });
      })
      .catch((error: unknown) => {
        if (isAbort(error) || request !== recordSequence.current) return;
        const forbidden = error instanceof BusinessMapRequestError && (error.status === 401 || error.status === 403);
        setRecordsForbidden(forbidden);
        setRecordsError(error instanceof BusinessMapRequestError ? error.message : "资料暂时无法读取，请重试");
        if (forbidden) setRecords(null);
      })
      .finally(() => {
        if (request === recordSequence.current) setRecordsLoading(false);
      });
    return () => controller.abort();
  }, [activeSource, chosen?.entity, currentCompanyId, page, recordQuery, recordsRetry, scope, unit]);

  const allDomains = useMemo(() => [...new Set((catalog?.groups || []).map((group) => group.path[1]).filter(Boolean))], [catalog]);
  const matches = useMemo(() => filterCatalog(catalog?.groups || [], domains, catalogSearch), [catalog, domains, catalogSearch]);
  const response = records?.scope === scope ? records.data : null;
  const responseIdentity = response?.records.map((record) => record.id).join("\u0001") || "";
  const responseStatus = response?.status || (activeSource ? "ready" : "unknown");
  const status = sourceStatus(recordsForbidden ? "forbidden" : responseStatus);
  const recordColumnsStyle = { "--business-map-column-count": chosen?.entity.columns.length || 1 } as CSSProperties;

  const setEntity = (entity: BusinessMapEntity) => {
    const firstSource = entity.sources[0]?.id || null;
    patchParams({ entity: entity.code, source: firstSource, q: null, unit: null, page: "1", expanded: null });
    if (window.innerWidth <= 1100) requestAnimationFrame(() => recordsRef.current?.scrollIntoView({ block: "start", behavior: "auto" }));
  };

  const toggleObject = (id: string) => {
    const next = new Set(openObjectIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    patchParams({ objects: [...next].join(",") || null });
  };

  const toggleRecord = (index: number) => {
    const next = new Set(expandedRecords);
    if (next.has(index)) next.delete(index); else next.add(index);
    patchParams({ expanded: serializeIndexList(next) || null });
  };

  const changeCompany = (companyId: string) => {
    persistCompanyPreference(companyId);
    patchParams({ companyId: companyId || null, entity: null, source: null, q: null, unit: null, page: null, expanded: null, objects: null });
  };

  const changeSource = (nextSource: string) => patchParams({ source: nextSource, q: null, unit: null, page: "1", expanded: null });
  const changeRecordQuery = (nextQuery: string) => patchParams({ q: nextQuery, page: "1", expanded: null });
  const followLink = (nextEntityCode: string, nextUnit?: string) => {
    const destination = selectedEntity(catalog, nextEntityCode);
    if (!destination) return;
    const originSource = response?.source || activeSource?.id;
    if (!originSource || !destination.entity.sources.some((item) => item.id === originSource)) {
      setRecordsError("当前来源尚未接入这项关联资料");
      return;
    }
    patchParams({ entity: destination.entity.code, source: originSource, unit: nextUnit || null, q: null, page: "1", expanded: null });
  };

  useEffect(() => {
    if (!response) return;
    const previous = recordIdentity.current;
    recordIdentity.current = { scope, value: responseIdentity };
    if (previous?.scope === scope && previous.value !== responseIdentity && expandedRecords.size) {
      patchParams({ expanded: null });
    }
  }, [expandedRecords.size, response, responseIdentity, scope]);

  return (
    <section className="business-map-workspace" aria-label="业务地图" data-business-map-workspace ref={workspaceRef} style={availableHeight === null ? undefined : ({ "--business-map-frame-height": `${availableHeight}px` } as CSSProperties)}>
      <section className="business-map-catalog" aria-labelledby="business-map-catalog-title">
        <div className="business-map-title-block">
          <h1 className="business-map-title" id="business-map-catalog-title">业务对象</h1>
          <p className="business-map-context">按当前公司与授权范围浏览业务目录</p>
        </div>
        <div className="business-map-filters">
          {companyOptions(catalog).length > 1 && (
            <label className="business-map-filter-label">公司
              <select aria-label="公司范围" value={currentCompanyId} onChange={(event) => changeCompany(event.target.value)}>
                {companyOptions(catalog).map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}
              </select>
            </label>
          )}
          <div className="business-map-filter-label">业务域
            <Select className="business-map-domain-select" aria-label="业务域范围" mode="multiple" size="small" value={domains}
              allowClear showSearch maxTagCount="responsive" placeholder="全部业务域（可多选）"
              options={allDomains.map((domain) => ({ label: domain, value: domain }))}
              onChange={(values: string[]) => patchParams({ domains: values.join(",") || null })} />
          </div>
          <input className="business-map-search" aria-label="搜索业务对象、逻辑实体或目录路径" value={catalogSearch} onChange={(event) => patchParams({ catalogQ: event.target.value || null })} placeholder="搜索对象、实体或目录路径" />
        </div>
        {catalogLoading && <p className="business-map-state" role="status">正在读取业务目录…</p>}
        {catalogError && <div className="business-map-state" data-state="error" role="alert"><span>{catalogError}</span><button type="button" className="business-map-text-button" onClick={() => setCatalogRetry((value) => value + 1)}>重试读取</button></div>}
        {!catalogLoading && !catalogError && (
          <div className="business-map-directory" data-business-map-catalog>
            {matches.map(({ group, entities, entityMatched }) => {
              const expanded = openObjectIds.has(group.id) || (!!catalogSearch && entityMatched);
              return <div className="business-map-object" key={group.id}>
                <div className="business-map-object-row">
                  <button type="button" className="business-map-icon-button" aria-label={`${expanded ? "收起" : "展开"}${group.path[3]}`} aria-expanded={expanded} onClick={() => toggleObject(group.id)}><span className="business-map-chevron" data-expanded={expanded}>›</span></button>
                  <div className="business-map-breadcrumb" title={group.path.join(" / ")}>
                    <span>{group.path[0]}</span><i>/</i><span>{group.path[1]}</span><i>/</i><span>{group.path[2]}</span><i>/</i><strong>{group.path[3]}</strong>
                  </div>
                </div>
                {expanded && <div className="business-map-entities">
                  {entities.map((entity) => <button type="button" className="business-map-entity" aria-current={entity.code === entityCode || undefined} key={entity.code} onClick={() => setEntity(entity)}><span>{entity.name}</span></button>)}
                </div>}
              </div>;
            })}
            {!matches.length && <p className="business-map-empty">没有符合当前目录条件的业务对象</p>}
          </div>
        )}
        <p className="business-map-help">专项视图：<Link className="business-map-link" to="/admin/lead-funnel">线索漏斗</Link> / <Link className="business-map-link" to="/admin/project-delivery">项目交付</Link></p>
      </section>

      <section className="business-map-records" aria-labelledby="business-map-records-title" ref={recordsRef}>
        {!chosen ? (
          <div className="business-map-state"><h2 className="business-map-title" id="business-map-records-title">数据记录</h2><p className="business-map-empty">选择业务逻辑实体查看数据</p></div>
        ) : (
          <>
            <div className="business-map-title-block">
              <h2 className="business-map-title" id="business-map-records-title">{chosen.entity.name}</h2>
              <p className="business-map-path">{chosen.group.path.join(" / ")}</p>
            </div>
            <div className="business-map-record-tools">
              {chosen.entity.sources.length > 0 ? (
                <label className="business-map-filter-label">数据来源
                  <select aria-label="数据来源" value={source} onChange={(event) => changeSource(event.target.value)}>
                    {chosen.entity.sources.map((item) => <option key={item.id} value={item.id}>{item.label}{item.available ? "" : "（尚未接入）"}</option>)}
                  </select>
                </label>
              ) : <span className="business-map-status" data-status="unknown">来源未知</span>}
              <input className="business-map-search" aria-label="搜索当前实体记录" value={recordQuery} onChange={(event) => changeRecordQuery(event.target.value)} placeholder="搜索名称、所属组织等" />
              {unit && <span className="business-map-scope-filter">已限定组织范围 <button type="button" className="business-map-text-button" onClick={() => patchParams({ unit: null, page: "1", expanded: null })}>清除</button></span>}
              <span className="business-map-status" data-status={recordsForbidden ? "forbidden" : responseStatus}>{status.label}</span>
            </div>
            {response?.observedAt && <p className="business-map-source-note">采集时间：{formatSourceTime(response.observedAt)}{response.source === "wecom" ? "；历史资料，尚未应用到平台组织" : ""}</p>}
            {response?.note && <p className="business-map-source-note">{response.note}</p>}
            {recordsLoading && !response && <p className="business-map-state" role="status">正在读取当前实体资料…</p>}
            {recordsError && <div className="business-map-state" data-state={recordsForbidden ? "forbidden" : "error"} role="alert"><span>{recordsError}{response ? "；保留上次成功结果，可能已过期" : ""}</span>{!recordsForbidden && <button type="button" className="business-map-text-button" onClick={() => setRecordsRetry((value) => value + 1)}>重试读取</button>}</div>}
            {!recordsLoading && !recordsError && response?.status === "not_connected" && <div className="business-map-state"><p>{sourceStatus("not_connected").detail}</p></div>}
            {!recordsLoading && !recordsError && response?.status === "not_read" && <div className="business-map-state"><p>{sourceStatus("not_read").detail}</p></div>}
            {response?.status === "ready" && (
              <>
                {response.records.length > 0 ? (
                  <div className="business-map-record-table" style={recordColumnsStyle} data-business-map-records>
                    <div className="business-map-record-head"><span aria-hidden="true" />{chosen.entity.columns.map((column) => <span key={column.key}>{column.label}</span>)}</div>
                    {response.records.map((record, index) => <RecordRow record={record} index={index} entity={chosen.entity} expanded={expandedRecords.has(index)} onToggle={toggleRecord} onFollowLink={followLink} key={record.id} />)}
                  </div>
                ) : <div className="business-map-state"><p>{recordQuery || unit ? "没有符合当前条件的记录" : "当前可见范围暂无记录"}</p>{(recordQuery || unit) && <button type="button" className="business-map-text-button" onClick={() => patchParams({ q: null, unit: null, page: "1", expanded: null })}>清除条件</button>}</div>}
                <div className="business-map-pagination" aria-label="记录分页">
                  {response.total !== null && <span className="business-map-record-total">共 {response.total} 条</span>}
                  <span className="business-map-record-total">第 {response.page} 页</span>
                  <button type="button" className="business-map-text-button" disabled={response.page <= 1} onClick={() => patchParams({ page: String(Math.max(1, response.page - 1)), expanded: null })}>上一页</button>
                  <button type="button" className="business-map-text-button" disabled={response.total !== null ? response.page * response.pageSize >= response.total : response.records.length < response.pageSize} onClick={() => patchParams({ page: String(response.page + 1), expanded: null })}>下一页</button>
                </div>
              </>
            )}
          </>
        )}
      </section>
    </section>
  );
}

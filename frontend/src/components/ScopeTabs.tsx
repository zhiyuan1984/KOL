import { KB_SCOPE_ALL, KB_SCOPE_BASE, KB_SCOPE_DOMAIN, KB_SCOPE_FAMILY, KB_SCOPE_LEAD } from "../knowledgeCopy";

export type ScopeOption = { id: string; name: string; count?: number };

type Props = {
  familyOptions: ScopeOption[];
  domainOptions: ScopeOption[];
  baseOptions: ScopeOption[];
  familyId: string;
  domainId: string;
  baseId: string;
  onFamily: (id: string) => void;
  onDomain: (id: string) => void;
  onBase: (id: string) => void;
  familyTotal: number;
  domainTotal: number;
  baseTotal: number;
};

/** 三级分类联动 tab：业务域 → 业务主题 → 知识库；值直接露出、点选即筛，上级变化时下级重算。 */
export default function ScopeTabs({
  familyOptions, domainOptions, baseOptions,
  familyId, domainId, baseId,
  onFamily, onDomain, onBase,
  familyTotal, domainTotal, baseTotal,
}: Props) {
  return (
    <div className="kbv-scope-rows" data-kb-scope-picker aria-label={KB_SCOPE_LEAD}>
      <div className="kbv-scope-row">
        <span className="kbv-scope-name">{KB_SCOPE_FAMILY}</span>
        <div className="kbv-scope-tabs" role="group" aria-label={KB_SCOPE_FAMILY}>
          <button
            type="button"
            className="kbv-tab"
            aria-pressed={!familyId}
            data-kb-scope-family=""
            onClick={() => onFamily("")}
          >
            {KB_SCOPE_ALL} <small>{familyTotal}</small>
          </button>
          {familyOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className="kbv-tab"
              aria-pressed={familyId === option.id}
              data-kb-scope-family={option.id}
              onClick={() => onFamily(option.id)}
            >
              {option.name} <small>{option.count ?? 0}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="kbv-scope-row">
        <span className="kbv-scope-name">{KB_SCOPE_DOMAIN}</span>
        <div className="kbv-scope-tabs" role="group" aria-label={KB_SCOPE_DOMAIN}>
          <button
            type="button"
            className="kbv-tab"
            aria-pressed={!domainId}
            data-kb-scope-domain=""
            onClick={() => onDomain("")}
          >
            {KB_SCOPE_ALL} <small>{domainTotal}</small>
          </button>
          {domainOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className="kbv-tab"
              aria-pressed={domainId === option.id}
              data-kb-scope-domain={option.id}
              onClick={() => onDomain(option.id)}
            >
              {option.name} <small>{option.count ?? 0}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="kbv-scope-row">
        <span className="kbv-scope-name">{KB_SCOPE_BASE}</span>
        <div className="kbv-scope-tabs" role="group" aria-label={KB_SCOPE_BASE}>
          <button
            type="button"
            className="kbv-tab"
            aria-pressed={!baseId}
            data-kb-scope-base=""
            onClick={() => onBase("")}
          >
            {KB_SCOPE_ALL} <small>{baseTotal}</small>
          </button>
          {baseOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className="kbv-tab"
              aria-pressed={baseId === option.id}
              data-kb-scope-base={option.id}
              onClick={() => onBase(option.id)}
            >
              {option.name} <small>{option.count ?? 0}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

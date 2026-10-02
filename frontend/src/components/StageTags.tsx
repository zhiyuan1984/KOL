import { KB_FILTER_LABEL } from "../knowledgeCopy";
import { stageLabel } from "../labels";
import { MAIN_STAGE_TABS } from "../kolStages";

type Props = {
  selected: string[];
  onChange: (next: string[]) => void;
  /** 可增加的阶段（默认全量 SOP 阶段；筛选场景传入数据中出现的阶段）。 */
  options?: string[];
  /** 容器附加数据钩子（如筛选行的 data-kb-filter="stage"）。 */
  rootAttrs?: Record<string, string>;
};

/** 适用阶段标签行：芯片＋可增加、×可移除；不设「全部」标签——不选即不筛。 */
export default function StageTags({ selected, onChange, options, rootAttrs }: Props) {
  const candidates = options ?? MAIN_STAGE_TABS.map((stage) => stage.code);
  const rest = candidates.filter((code) => !selected.includes(code));
  const nameOf = (code: string) => stageLabel(code) || code;
  return (
    <div className="kbv-stage-row" data-kb-stage-tags {...rootAttrs}>
      <span className="kbv-scope-name">{KB_FILTER_LABEL.stage}</span>
      <div className="kbv-stage-tags">
        {selected.map((code) => (
          <span className="chip kbv-stage-tag" key={code}>
            {nameOf(code)}
            <button
              type="button"
              className="kbv-stage-x"
              data-kb-stage-remove={code}
              aria-label={`移除${nameOf(code)}`}
              onClick={() => onChange(selected.filter((item) => item !== code))}
            >
              ×
            </button>
          </span>
        ))}
        {rest.length ? (
          <select
            className="kbv-stage-add"
            data-kb-stage-add
            aria-label="增加适用阶段"
            value=""
            onChange={(event) => {
              const code = event.target.value;
              if (code) onChange([...selected, code]);
            }}
          >
            <option value="">＋</option>
            {rest.map((code) => (
              <option key={code} value={code}>{nameOf(code)}</option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}

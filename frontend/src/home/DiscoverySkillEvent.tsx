import type { SkillTemplate } from "../api";
import SkillTemplateContext from "../components/SkillTemplateContext";

/**
 * ① 展示技能：采集线索的交互模板全文（功能 / 预计执行步骤 / 输出说明 /
 * 结果依据 / 需要你决定 / 使用边界 / 异常与恢复）。默认展开、平铺排版，
 * 内部不加滚动条，也不套第二层卡片。
 */
export default function DiscoverySkillEvent({ template }: { template: SkillTemplate | null }) {
  if (!template) return null;
  return (
    <section
      className="discovery-event"
      data-discovery-event="skill"
      data-discovery-event-index="1"
      aria-label="AI发现技能说明"
    >
      <SkillTemplateContext template={template} flat showOptionalInputs={false} className="discovery-skill-context" />
    </section>
  );
}

/**
 * ② 引导填写：说明这些条件都是可选的，并给出「先核对参数、再确认采集」的顺序。
 * 字段与选项本身由下方的条件卡呈现，这里不重复渲染清单。
 */
export function DiscoveryGuidanceEvent() {
  return (
    <section
      className="discovery-event"
      data-discovery-event="guidance"
      data-discovery-event-index="2"
      aria-label="填写引导"
    >
      <p className="muted" data-discovery-guidance>
        以下发现条件均可选，不需要全部填写；提交后先核对实际采集参数，再确认开始采集。
      </p>
    </section>
  );
}

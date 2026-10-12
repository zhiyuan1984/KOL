import SectionTabs from "../components/SectionTabs";
import Leads from "./Leads";
import Cooperations from "./Cooperations";
import "./kol-lead-coop.css";

/** 员工端「业务地图」：线索管理 / 合作项目 两个既有页面收进同一表面的 tab。
 *  URL 保持 /leads 与 /cooperations（深链与下钻参数不变，ia §1.1 不涉路由迁移）。 */
export default function BusinessMap({ view }: { view: "leads" | "cooperations" }) {
  return (
    <div className="business-map" data-kol-business-map={view}>
      <SectionTabs
        ariaLabel="业务地图视图"
        activeId={view}
        tabs={[
          { id: "leads", label: "线索管理", href: "/leads" },
          { id: "cooperations", label: "合作项目", href: "/cooperations" },
        ]}
      />
      {view === "leads" ? <Leads /> : <Cooperations />}
    </div>
  );
}

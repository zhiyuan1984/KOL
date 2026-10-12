import SectionTabs from "../components/SectionTabs";
import AdminLeadFunnel from "./AdminLeadFunnel";
import AdminProjectDelivery from "./AdminProjectDelivery";
import "./admin-observability.css";

/** 管理端「业务地图」：线索漏斗 / 项目交付 两个只读看板收进同一表面的 tab。
 *  URL 保持 /admin/lead-funnel 与 /admin/project-delivery（深链与既有断言不变）。 */
export default function AdminBusinessMap({ active }: { active: "lead-funnel" | "project-delivery" }) {
  return (
    <div className="admin-business-map" data-admin-business-map={active}>
      <SectionTabs
        ariaLabel="业务地图视图"
        activeId={active}
        tabs={[
          { id: "lead-funnel", label: "线索漏斗", href: "/admin/lead-funnel" },
          { id: "project-delivery", label: "项目交付", href: "/admin/project-delivery" },
        ]}
      />
      {active === "lead-funnel" ? <AdminLeadFunnel /> : <AdminProjectDelivery />}
    </div>
  );
}

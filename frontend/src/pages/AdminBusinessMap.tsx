import BusinessMapWorkspace from "../admin/business-map/BusinessMapWorkspace";
import "./admin-observability.css";

/** 管理端业务地图只浏览目录与授权记录；专项看板仍分别留在其既有深链。 */
export default function AdminBusinessMap() {
  return (
    <div className="admin-business-map" data-admin-business-map="business-map">
      <BusinessMapWorkspace />
    </div>
  );
}

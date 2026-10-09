import { ArrowRightOutlined, BarChartOutlined, CalendarOutlined, ExportOutlined, HeartOutlined, UserOutlined, WarningOutlined } from "@ant-design/icons";

export function KolFactIcon({ type }: { type: "followers" | "avg-plays" | "engagement" | "ingested" | "alert" | "arrow" | "external" }) {
  const Icon = { followers: UserOutlined, "avg-plays": BarChartOutlined, engagement: HeartOutlined, ingested: CalendarOutlined, alert: WarningOutlined, arrow: ArrowRightOutlined, external: ExportOutlined }[type];
  return <Icon className="kol-card-icon" aria-hidden="true" />;
}

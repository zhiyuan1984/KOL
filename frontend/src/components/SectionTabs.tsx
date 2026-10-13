import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export type SectionTab = {
  id: string;
  label: string;
  href: string;
};

/** 导航 state：本次跳转希望目标页把焦点交还到的 tab id（←→ 或点击切换时携带）。 */
type SectionTabsFocusState = { focusSectionTab?: string } | null;

/** 跨页共用的视图切换条：role=tablist/tab + aria-selected + ←→ 键盘切换；
 *  视觉沿用 styles.css 的 .home-tabs（token 口径与 Home 页签一致），不新增样式数值。
 *  tab 切换跨路由会重挂载，焦点经导航 state 交还；激活 tab 重复点击保持 URL（含下钻参数）不动。 */
export default function SectionTabs({
  tabs,
  activeId,
  ariaLabel,
}: {
  tabs: SectionTab[];
  activeId: string;
  ariaLabel: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  // 仅在导航携带了聚焦意图时接管焦点；深链直达与首次进入不抢焦点。
  // 依赖 activeId：重挂载（跨路由）与同实例切换两种路径都覆盖。
  useEffect(() => {
    const state = location.state as SectionTabsFocusState;
    if (state?.focusSectionTab === activeId) buttons.current[activeId]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const select = (tab: SectionTab) => {
    if (tab.id === activeId) return;
    navigate(tab.href, { state: { focusSectionTab: tab.id } });
  };

  const move = (index: number, delta: number) => {
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) select(next);
  };

  return (
    <div className="home-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => {
        const selected = tab.id === activeId;
        return (
          <button
            key={tab.id}
            ref={(node) => { buttons.current[tab.id] = node; }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            data-section-tab={tab.id}
            onClick={() => select(tab)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(index, -1);
              }
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

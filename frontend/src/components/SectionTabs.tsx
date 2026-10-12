import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

export type SectionTab = {
  id: string;
  label: string;
  href: string;
};

/** 跨页共用的视图切换条：role=tablist/tab + aria-selected + ←→ 键盘切换；
 *  视觉沿用 styles.css 的 .home-tabs（token 口径与 Home 页签一致），不新增样式数值。 */
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
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusPending = useRef(false);

  // ←→ 切换后把焦点交还到当前选中项；普通点击/首屏进入不抢焦点。
  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    buttons.current[activeId]?.focus();
  }, [activeId]);

  const move = (index: number, delta: number) => {
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (!next) return;
    focusPending.current = true;
    navigate(next.href);
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
            onClick={() => navigate(tab.href)}
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

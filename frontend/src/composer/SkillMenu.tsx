import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { groupSkills, isWriteSkill, labelOfSkill, matchesSkillQuery, type CatalogSkill } from "./catalog";
import { readRecentSkills } from "./recents";

const RECENT_GROUP_ID = "recent";
const RECENT_GROUP_LABEL = "最近使用";

type SkillRow = { index: number; skill: CatalogSkill };
type SkillSection = { id: string; label: string; rows: SkillRow[] };

export default function SkillMenu({
  skills,
  selectedSkillIds,
  onPick,
  onClose,
  autoFocus = true,
}: {
  skills: CatalogSkill[];
  selectedSkillIds: string[];
  onPick: (skill: CatalogSkill) => void;
  onClose: () => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    searchRef.current?.focus();
  }, [autoFocus]);

  const groups = useMemo(
    () => groupSkills(skills.filter((skill) => matchesSkillQuery(skill, query))),
    [query, skills],
  );

  const recents = useMemo(() => {
    if (query.trim()) return [];
    const byId = new Map(skills.map((skill) => [skill.id, skill]));
    return readRecentSkills()
      .map((id) => byId.get(id))
      .filter((skill): skill is CatalogSkill => Boolean(skill));
  }, [query, skills]);

  const sections = useMemo<SkillSection[]>(() => {
    const next: SkillSection[] = [];
    let index = 0;
    const push = (id: string, label: string, items: CatalogSkill[]) => {
      if (!items.length) return;
      next.push({ id, label, rows: items.map((skill) => ({ index: index++, skill })) });
    };
    push(RECENT_GROUP_ID, RECENT_GROUP_LABEL, recents);
    for (const group of groups) push(group.id, group.label, group.items);
    return next;
  }, [groups, recents]);

  const total = sections.reduce((sum, section) => sum + section.rows.length, 0);
  const active = activeIndex >= 0 && activeIndex < total ? activeIndex : -1;
  const activeRowId = active >= 0 ? rowId(active) : undefined;

  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(".is-active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const move = (delta: number) => {
    if (!total) return;
    setActiveIndex((current) => {
      const base = current < 0 || current >= total ? (delta > 0 ? -1 : 0) : current;
      return (base + delta + total) % total;
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // 输入法组合期间上下键属于候选词，不用于移动高亮
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!total) return;
      setActiveIndex(event.key === "Home" ? 0 : total - 1);
      return;
    }
    if (event.key !== "Enter") return;
    const row = sections.flatMap((section) => section.rows)[active >= 0 ? active : 0];
    if (!row || selectedSkillIds.includes(row.skill.id)) return;
    event.preventDefault();
    onPick(row.skill);
  };

  return (
    <>
      <label className="composer-skill-search">
        <span className="sr-only">搜索技能</span>
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="搜索技能"
          aria-label="搜索技能"
          data-composer-skill-search
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      <div
        className="composer-skill-list"
        ref={listRef}
        role="listbox"
        aria-label="技能列表"
        aria-activedescendant={activeRowId}
        data-composer-skill-list
      >
        {!skills.length ? (
          <p className="menu-empty">暂无已发布技能</p>
        ) : !sections.length ? (
          <p className="menu-empty">没有匹配项</p>
        ) : (
          <div className="composer-skill-groups" data-composer-skill-groups>
            {sections.map((section) => (
              <section key={section.id} className="composer-skill-group" data-skill-group={section.id}>
                <h3>{section.label}</h3>
                {section.rows.map(({ index, skill }) => {
                  const write = isWriteSkill(skill);
                  const selected = selectedSkillIds.includes(skill.id);
                  return (
                    <button
                      type="button"
                      role="menuitem"
                      key={`${section.id}-${index}`}
                      id={rowId(index)}
                      aria-selected={index === active}
                      className={index === active ? "is-active" : undefined}
                      data-skill-option={skill.id}
                      data-write-skill={write ? "true" : undefined}
                      disabled={selected}
                      onClick={() => onPick(skill)}
                    >
                      <strong>{labelOfSkill(skill)}</strong>
                      {write ? <small data-skill-confirm>需确认</small> : null}
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </div>
      <Link className="composer-skill-footer" to="/skills" onClick={onClose}>
        <span>查看全部技能</span>
        <span aria-hidden>→</span>
      </Link>
    </>
  );
}

function rowId(index: number) {
  return `composer-skill-row-${index}`;
}

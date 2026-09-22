import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AttachmentRef } from "../api";
import { DIGITAL_EMPLOYEES, SKILL_GROUPS, isWriteSkill, labelOfSkill, skillGroupOf, type CatalogSkill, type SkillGroupId } from "./catalog";
import { readRecentSkills } from "./recents";
import { DEFAULT_EXPERT_ID, type ConnectorDto, type KnowledgeLib } from "./types";

type ProjectOption = { id: string; label: string; handle?: string; description?: string };

type PlusRow = {
  key: string;
  icon: MenuKind;
  label: string;
  hint?: string;
  badge?: string;
  badgeTone?: "write";
  selected?: boolean;
  disabled?: boolean;
  attrs?: Record<string, string>;
  /** 参与搜索的额外文本（别名、id 等）。 */
  extra?: string;
  /** 行内动作需要留在面板里（例如过期连接器的恢复提示）：选中后不关闭面板。 */
  keepOpen?: boolean;
  run: () => void;
};

type PlusGroup = { id: string; label: string; rows: PlusRow[]; footer?: ReactNode };

export default function PlusMenu({
  open,
  onClose,
  onUploadFile,
  onUploadImage,
  onPickSkill,
  onPickKb,
  onPickConnector,
  onPickExpert,
  onPickProject,
  onReuseFile,
  skills,
  knowledgeLibs,
  connectors,
  recentFiles,
  projects,
  selectedSkillIds,
  expertId,
}: {
  open: boolean;
  onClose: () => void;
  onUploadFile: () => void;
  onUploadImage: () => void;
  onPickSkill: (skill: CatalogSkill) => void;
  onPickKb: (row: KnowledgeLib) => void;
  onPickConnector: (row: ConnectorDto) => void;
  onPickExpert: (id: string) => void;
  onPickProject: (project: ProjectOption) => void;
  onReuseFile: (file: AttachmentRef & { available?: boolean }) => void;
  skills: CatalogSkill[];
  knowledgeLibs: KnowledgeLib[];
  connectors: ConnectorDto[];
  recentFiles: (AttachmentRef & { available?: boolean })[];
  projects: ProjectOption[];
  selectedSkillIds: string[];
  expertId: string;
}) {
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setToast("");
      setQuery("");
      return;
    }
    searchRef.current?.focus();
  }, [open]);

  const groups = useMemo<PlusGroup[]>(() => {
    const skillOrder = new Map<SkillGroupId, number>(SKILL_GROUPS.map((group, index) => [group.id, index]));
    const stageLabel = new Map<SkillGroupId, string>(SKILL_GROUPS.map((group) => [group.id, group.label]));
    const byId = new Map(skills.map((skill) => [skill.id, skill]));
    const recentSkills = readRecentSkills()
      .map((id) => byId.get(id))
      .filter((skill): skill is CatalogSkill => Boolean(skill));
    const recentIds = new Set(recentSkills.map((skill) => skill.id));
    const rest = skills
      .filter((skill) => !recentIds.has(skill.id))
      .sort((a, b) => (skillOrder.get(skillGroupOf(a)) ?? 99) - (skillOrder.get(skillGroupOf(b)) ?? 99));
    const skillRow = (skill: CatalogSkill): PlusRow => {
      const stage = skillGroupOf(skill);
      const write = isWriteSkill(skill);
      return {
        key: `skill:${skill.id}`,
        icon: "skills",
        label: labelOfSkill(skill),
        hint: recentIds.has(skill.id) ? `最近使用 · ${stageLabel.get(stage) || ""}`.replace(/ · $/, "") : stageLabel.get(stage),
        badge: write ? "需确认" : undefined,
        badgeTone: write ? "write" : undefined,
        disabled: selectedSkillIds.includes(skill.id),
        attrs: {
          "data-skill-option": skill.id,
          ...(write ? { "data-skill-confirm": "true" } : {}),
        },
        extra: `${skill.id} ${(skill.aliases || []).join(" ")}`,
        run: () => onPickSkill(skill),
      };
    };

    const next: PlusGroup[] = [];
    // 分组顺序由所有者在 2026-09-23 定下：文件 / 技能 / 知识库 / 数字员工 / 连接器 / 项目。
    // 「文件」= 上传入口 + 最近的文件（没有单独的「添加」组）；Discovery 走 AI发现面，菜单不再放作业组。
    next.push({
      id: "files",
      label: "文件",
      rows: [
        { key: "upload", icon: "upload", label: "上传文件", hint: "把本地文件加进提问", run: onUploadFile },
        { key: "image", icon: "image", label: "上传图片", hint: "把本地图片加进提问", run: onUploadImage },
        ...recentFiles.map((file) => ({
          key: `recent:${file.id || file.path}`,
          icon: "recent" as MenuKind,
          label: file.name,
          hint: [file.type || "文件", file.size ? formatSize(file.size) : ""].filter(Boolean).join(" · "),
          disabled: file.available === false,
          attrs: { "data-composer-menu-file": file.id || file.path },
          run: () => onReuseFile(file),
        })),
      ],
    });
    // 技能还在异步加载时不要留一个空分组（连「查看全部技能」也一起省掉）。
    const skillRows = [...recentSkills, ...rest].map(skillRow);
    if (skillRows.length) {
      next.push({
        id: "skills",
        label: "技能",
        rows: skillRows,
        footer: (
          <Link className="composer-menu-more" role="menuitem" to="/skills" onClick={onClose} data-composer-menu-all-skills>
            <span>查看全部技能</span>
            <span aria-hidden>→</span>
          </Link>
        ),
      });
    }
    if (knowledgeLibs.length) {
      next.push({
        id: "kb",
        label: "知识库",
        rows: knowledgeLibs.map((row) => ({
          key: `kb:${row.id}`,
          icon: "kb" as MenuKind,
          label: row.shortName,
          hint: row.title,
          attrs: { "data-composer-menu-kb": row.id },
          run: () => onPickKb(row),
        })),
      });
    }
    next.push({
      id: "experts",
      label: "数字员工",
      rows: DIGITAL_EMPLOYEES.map((row) => ({
        key: `expert:${row.id}`,
        icon: "expert" as MenuKind,
        label: row.label,
        hint: row.id === DEFAULT_EXPERT_ID ? "默认岗位" : "为这次提问指定岗位",
        selected: row.id === expertId,
        attrs: { "data-expert-option": row.id, "aria-pressed": row.id === expertId ? "true" : "false" },
        run: () => onPickExpert(row.id),
      })),
    });
    if (connectors.length) {
      next.push({
        id: "connectors",
        label: "连接器",
        rows: connectors.map((row) => ({
          key: `connector:${row.id}`,
          icon: "connector" as MenuKind,
          label: row.label,
          hint: row.expired ? "已过期" : row.access === "read" ? "只读" : "已授权",
          attrs: { "data-connector-expired": row.expired ? "true" : "false" },
          // 过期的连接器不静默禁用：给出原因 + 去连接器页的恢复入口（面板保持打开）。
          keepOpen: row.expired,
          run: () => {
            if (!row.expired) {
              onPickConnector(row);
              return;
            }
            setToast("连接器已过期，请到连接器页处理。");
          },
        })),
      });
    }
    if (projects.length) {
      next.push({
        id: "projects",
        label: "项目",
        rows: projects.map((project) => ({
          key: `project:${project.id}`,
          icon: "project" as MenuKind,
          label: project.label,
          hint: project.description,
          attrs: { "data-project-option": project.id },
          run: () => onPickProject(project),
        })),
      });
    }
    return next;
  }, [
    connectors,
    expertId,
    knowledgeLibs,
    onPickConnector,
    onPickExpert,
    onPickKb,
    onPickProject,
    onPickSkill,
    onReuseFile,
    onUploadFile,
    onUploadImage,
    projects,
    recentFiles,
    selectedSkillIds,
    skills,
  ]);

  const needle = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    if (!needle) return groups;
    return groups
      .map((group) => (
        group.label.toLowerCase().includes(needle)
          ? group
          : { ...group, rows: group.rows.filter((row) => rowHaystack(row).includes(needle)) }
      ))
      .filter((group) => group.rows.length > 0);
  }, [groups, needle]);

  if (!open) return null;

  const rowNodes = () => Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-composer-menu-row]") || []);

  const choose = (row: PlusRow) => {
    if (row.disabled) return;
    if (!row.keepOpen) onClose();
    row.run();
  };

  return (
    <div
      ref={rootRef}
      className="menu-popover composer-add-menu cascade-menu"
      role="menu"
      aria-label="添加内容"
      data-composer-plus-menu
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
          rootRef.current?.parentElement?.querySelector<HTMLElement>("[data-attach]")?.focus();
          return;
        }
        const list = rowNodes();
        const index = list.indexOf(document.activeElement as HTMLElement);
        if (event.key === "ArrowDown") {
          event.preventDefault();
          const next = index < 0 || index === list.length - 1 ? list[0] : list[index + 1];
          next?.focus();
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          if (index <= 0) searchRef.current?.focus();
          else list[index - 1]?.focus();
          return;
        }
        if ((event.key === "Home" || event.key === "End") && index >= 0 && list.length) {
          event.preventDefault();
          (event.key === "Home" ? list[0] : list[list.length - 1]).focus();
          return;
        }
        // 任何可打印字符都回到搜索框继续输入。
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && event.target !== searchRef.current) {
          searchRef.current?.focus();
        }
      }}
    >
      {toast ? (
        <p className="composer-menu-toast" role="status" data-composer-menu-toast>
          {toast}
          <Link to="/connectors">去连接器</Link>
        </p>
      ) : null}
      <label className="composer-menu-search">
        <span className="sr-only">搜索可用条目</span>
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="搜索文件、知识库、技能…"
          aria-label="搜索可用条目"
          data-composer-menu-search
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // 回车绝不提交提问框：有查询时选中第一条匹配项；没有查询时什么都不做。
            event.preventDefault();
            if (!query.trim()) return;
            const match = visibleGroups.flatMap((group) => group.rows)[0];
            if (match) choose(match);
          }}
        />
      </label>
      <div className="cascade-scroll" data-composer-menu-list>
        {!visibleGroups.length ? (
          <p className="menu-empty" data-composer-menu-empty>没有匹配的条目</p>
        ) : (
          visibleGroups.map((group) => (
            <section key={group.id} className="composer-menu-section" data-menu-section={group.label}>
              <h3>{group.label}</h3>
              {group.rows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  title={row.hint}
                  disabled={row.disabled}
                  className={row.selected ? "is-current" : undefined}
                  data-composer-menu-row
                  {...row.attrs}
                  onClick={() => choose(row)}
                >
                  <MenuIcon kind={row.icon} />
                  <span className="menu-text">
                    <span className="menu-label">{row.label}</span>
                    {row.hint ? <span className="menu-hint">{row.hint}</span> : null}
                  </span>
                  {row.badge ? (
                    <span
                      className={"skill-mark" + (row.badgeTone === "write" ? " is-write" : "")}
                      data-skill-confirm={row.badgeTone === "write" ? "true" : undefined}
                    >
                      {row.badge}
                    </span>
                  ) : null}
                  {row.selected ? (
                    <svg className="menu-check" viewBox="0 0 16 16" aria-hidden>
                      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </button>
              ))}
              {group.footer}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function rowHaystack(row: PlusRow) {
  return `${row.label} ${row.hint || ""} ${row.badge || ""} ${row.extra || ""}`.toLowerCase();
}

type MenuKind = "upload" | "image" | "project" | "recent" | "skills" | "connector" | "kb" | "expert";

function MenuIcon({ kind }: { kind: MenuKind }) {
  const paths: Record<MenuKind, string> = {
    upload: "M12 16V5m0 0-4 4m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4",
    image: "M5 6.5h14v11H5z M8 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M6.5 16l4-4 3 3 2-2 4 3",
    project: "M3.5 7.5h6l1.5 2h9v9a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2zM3.5 7.5v-1a2 2 0 0 1 2-2h4",
    recent: "M5 6.5h11a2 2 0 0 1 2 2v11H7a2 2 0 0 1-2-2zm7 3v4l3 2",
    skills: "M5 5h5v5H5zm9 0h5v5h-5zM5 14h5v5H5zm9 0h5v5h-5z",
    connector: "M7 4v4m-2-2h4m8 10v4m-2-2h4M9 6h4a4 4 0 0 1 4 4v6M15 18h-4a4 4 0 0 1-4-4v-4",
    kb: "M5 5.5A2.5 2.5 0 0 1 7.5 3H12v16H7.5A2.5 2.5 0 0 0 5 21.5z M19 5.5A2.5 2.5 0 0 0 16.5 3H13v16h3.5a2.5 2.5 0 0 1 2.5 2.5z",
    expert: "M12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2",
  };
  return (
    <svg className="cascade-icon" viewBox="0 0 24 24" aria-hidden>
      <path d={paths[kind]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

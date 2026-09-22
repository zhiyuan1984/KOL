import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AttachmentRef } from "../api";
import { DIGITAL_EMPLOYEES, type CatalogSkill } from "./catalog";
import SkillMenu from "./SkillMenu";
import { DEFAULT_EXPERT_ID, type ConnectorDto, type KnowledgeLib } from "./types";

export type PlusSubpanel = "recent" | "kb" | "skills" | "connectors" | "experts" | "projects" | null;

type ProjectOption = { id: string; label: string; handle?: string; description?: string };

export default function PlusMenu({
  open,
  submenu,
  onSubmenu,
  onClose,
  onUploadFile,
  onUploadImage,
  onOpenDiscovery,
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
  submenu: PlusSubpanel;
  onSubmenu: (next: PlusSubpanel) => void;
  onClose: () => void;
  onUploadFile: () => void;
  onUploadImage: () => void;
  onOpenDiscovery?: () => void;
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
  const navigate = useNavigate();
  const [toast, setToast] = useState("");
  const singleLayer = useSingleLayer();

  useEffect(() => {
    if (!open) setToast("");
  }, [open]);

  if (!open) return null;

  const go = (next: PlusSubpanel) => onSubmenu(next);
  const showRoot = !submenu || !singleLayer;
  const showPanel = Boolean(submenu);

  return (
    <div className="menu-popover composer-add-menu cascade-menu" role="menu" aria-label="添加内容" data-composer-plus-menu>
      {toast ? (
        <p className="composer-menu-toast" role="status" data-composer-menu-toast>
          {toast}
          <Link to="/connectors">去连接器</Link>
        </p>
      ) : null}
      {showRoot ? (
        <div className="cascade-scroll">
          <MenuSection label="添加">
            <MenuButton icon="upload" label="上传文件" hint="把本地文件加进提问" onClick={() => { onClose(); onUploadFile(); }} />
            <MenuButton icon="image" label="上传图片" hint="把本地图片加进提问" onClick={() => { onClose(); onUploadImage(); }} />
            <MenuButton icon="recent" label="最近的文件" hint="从最近用过的文件里选" arrow onActivate={() => go("recent")} />
            <MenuButton icon="kb" label="从知识库引用" hint="引用知识库里的文档" arrow onActivate={() => go("kb")} />
          </MenuSection>
          <MenuSection label="能力">
            <MenuButton icon="skills" label="技能" hint="给这次提问挂一项技能" arrow onActivate={() => go("skills")} />
            <MenuButton icon="connector" label="连接器" hint="查看已授权的平台连接" arrow onActivate={() => go("connectors")} />
          </MenuSection>
          <MenuSection label="岗位">
            <MenuButton icon="expert" label="数字员工" hint="换一位数字员工来回答" arrow onActivate={() => go("experts")} />
          </MenuSection>
          <MenuSection label="作业">
            {onOpenDiscovery ? (
              <MenuButton
                icon="discover"
                label="发现红人模板"
                hint="用模板开一次发现作业"
                onClick={() => {
                  onClose();
                  onOpenDiscovery();
                }}
              />
            ) : (
              <p className="menu-empty">发现模板未接入</p>
            )}
          </MenuSection>
          <MenuSection label="更多">
            <MenuButton icon="project" label="添加到项目" hint="把这次提问归档到项目" arrow onActivate={() => go("projects")} />
          </MenuSection>
        </div>
      ) : null}

      {showPanel && submenu === "recent" ? (
        <Subpanel label="最近的文件" singleLayer={singleLayer} onBack={() => onSubmenu(null)}>
          {recentFiles.map((file) => (
            <button
              type="button"
              role="menuitem"
              key={file.id || file.path}
              disabled={file.available === false}
              onClick={() => onReuseFile(file)}
            >
              <MenuIcon kind="recent" />
              <span>
                <strong>{file.name}</strong>
                <small>{file.type || "文件"}{file.size ? ` · ${formatSize(file.size)}` : ""}</small>
              </span>
            </button>
          ))}
          {!recentFiles.length && <p className="menu-empty">暂无最近文件</p>}
        </Subpanel>
      ) : null}

      {showPanel && submenu === "kb" ? (
        <Subpanel label="从知识库引用" singleLayer={singleLayer} onBack={() => onSubmenu(null)}>
          {knowledgeLibs.map((row) => (
            <button type="button" role="menuitem" key={row.id} onClick={() => onPickKb(row)}>
              <MenuIcon kind="kb" />
              <span>
                <strong>{row.shortName}</strong>
                <small>{row.title}</small>
              </span>
            </button>
          ))}
          {!knowledgeLibs.length && <p className="menu-empty">未加入知识库</p>}
        </Subpanel>
      ) : null}

      {showPanel && submenu === "skills" ? (
        <Subpanel label="技能" singleLayer={singleLayer} onBack={() => onSubmenu(null)} search>
          <SkillMenu
            skills={skills}
            selectedSkillIds={selectedSkillIds}
            onPick={onPickSkill}
            onClose={onClose}
            autoFocus
          />
        </Subpanel>
      ) : null}

      {showPanel && submenu === "connectors" ? (
        <Subpanel label="连接器" singleLayer={singleLayer} onBack={() => onSubmenu(null)}>
          {connectors.map((row) => (
            <button
              type="button"
              role="menuitem"
              key={row.id}
              disabled={row.expired}
              data-connector-expired={row.expired ? "true" : undefined}
              onClick={() => {
                if (row.expired) {
                  setToast("连接器已过期，请到连接器页处理。");
                  navigate("/connectors");
                  onClose();
                  return;
                }
                onPickConnector(row);
              }}
            >
              <MenuIcon kind="connector" />
              <span>
                <strong>{row.label}</strong>
                <small>{row.expired ? "已过期" : row.access === "read" ? "只读" : "已授权"}</small>
              </span>
            </button>
          ))}
          {!connectors.length && <p className="menu-empty">无已授权连接器</p>}
        </Subpanel>
      ) : null}

      {showPanel && submenu === "experts" ? (
        <Subpanel label="数字员工" singleLayer={singleLayer} onBack={() => onSubmenu(null)}>
          {DIGITAL_EMPLOYEES.map((row) => (
            <button
              type="button"
              role="menuitem"
              key={row.id}
              aria-pressed={expertId === row.id}
              data-expert-option={row.id}
              onClick={() => onPickExpert(row.id)}
            >
              <MenuIcon kind="expert" />
              <span>
                <strong>{row.label}</strong>
                <small>{row.id === DEFAULT_EXPERT_ID ? "默认岗位，不显示芯片" : "切换后显示岗芯片"}</small>
              </span>
            </button>
          ))}
        </Subpanel>
      ) : null}

      {showPanel && submenu === "projects" ? (
        <Subpanel label="添加到项目" singleLayer={singleLayer} onBack={() => onSubmenu(null)}>
          {projects.map((project) => (
            <button type="button" role="menuitem" key={project.id} onClick={() => onPickProject(project)}>
              <MenuIcon kind="project" />
              <span>
                <strong>{project.label}</strong>
                <small>{project.description}</small>
              </span>
            </button>
          ))}
          {!projects.length && <p className="menu-empty">暂无可用项目</p>}
        </Subpanel>
      ) : null}
    </div>
  );
}

function MenuSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="composer-menu-section" data-menu-section={label}>
      <h3>{label}</h3>
      {children}
    </section>
  );
}

function Subpanel({
  label,
  children,
  singleLayer,
  onBack,
  search,
}: {
  label: string;
  children: ReactNode;
  singleLayer: boolean;
  onBack: () => void;
  search?: boolean;
}) {
  return (
    <div
      className={"menu-popover cascade-submenu" + (singleLayer ? " is-single-layer" : "")}
      role="menu"
      aria-label={label}
      data-composer-subpanel
    >
      {singleLayer ? (
        <button type="button" className="composer-menu-back" onClick={onBack}>
          ← 返回
        </button>
      ) : null}
      <div className={"submenu-scroll" + (search ? " has-search" : "")}>{children}</div>
    </div>
  );
}

type MenuKind = "upload" | "image" | "project" | "recent" | "skills" | "connector" | "kb" | "expert" | "discover";

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
    discover: "M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z M16 16l5 5",
  };
  return (
    <svg className="cascade-icon" viewBox="0 0 24 24" aria-hidden>
      <path d={paths[kind]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MenuButton({
  icon,
  label,
  hint,
  arrow,
  onClick,
  onActivate,
}: {
  icon: MenuKind;
  label: string;
  hint?: string;
  arrow?: boolean;
  onClick?: () => void;
  onActivate?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      title={hint}
      onClick={onClick || onActivate}
      onMouseEnter={() => {
        if (!onActivate) return;
        if (window.matchMedia("(max-width: 720px)").matches) return;
        onActivate();
      }}
      onFocus={onActivate}
    >
      <MenuIcon kind={icon} />
      <span className="menu-text">
        <span className="menu-label">{label}</span>
        {hint ? <span className="menu-hint">{hint}</span> : null}
      </span>
      {arrow && <span className="menu-arrow" aria-hidden>›</span>}
    </button>
  );
}

function useSingleLayer() {
  const [single, setSingle] = useState(() => (
    typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches
  ));
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setSingle(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return single;
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

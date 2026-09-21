import { useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgeRow } from "../api";
import ChipRail from "../composer/ChipRail";
import { expertChipLabel, isWriteSkill, labelOfSkill, type CatalogSkill } from "../composer/catalog";
import { peekComposerDraft, takeComposerDraftStash } from "../composer/draft";
import ModelTierControl from "../composer/ModelTierControl";
import PlusMenu, { type PlusSubpanel } from "../composer/PlusMenu";
import SkillMenu from "../composer/SkillMenu";
import { pushRecentSkill } from "../composer/recents";
import {
  clientEntryFor,
  COMPOSER_DRAFT_EVENT,
  COMPOSER_MAX_SKILL_CHIPS,
  COMPOSER_PLACEHOLDER,
  DEFAULT_EXPERT_ID,
  MODEL_TIER_EVENT,
  readModelTier,
  type ComposerChip,
  type ComposerClientEntry,
  type ComposerDraftStash,
  type ComposerEntryIntent,
  type ComposerObjectRef,
  type ComposerScope,
  type ConnectorDto,
  type KnowledgeLib,
} from "../composer/types";
import { connectorUseAccess, connectorUseLabel, connectorUseStatus, preferCanonicalConnectors } from "../connectorUse";
import {
  canSubmitDiscovery,
  DISCOVERY_CHIP_OVERRIDE_HINT,
  DISCOVERY_DIRECTION_PACKS,
  DISCOVERY_INTENT,
  DISCOVERY_LOCK_LABEL,
  DISCOVERY_REGION_OPTIONS,
  keywordsForDirections,
  MAX_DISCOVERY_DIRECTIONS,
  OVERSEAS_DISCOVERY_PLATFORMS,
  toggleDirection,
  type DiscoveryBrief,
  type DiscoveryDirectionCode,
  type DiscoveryPlatformCode,
  type DiscoveryTemplate,
} from "../home/discoveryTemplate";
import {
  composerFillText,
  composerHoldsTemplateBody,
  pickDefaultMailTemplate,
  skillLabel,
  templateBodyExcerpt,
  type LockedMailTemplate,
} from "../knowledgeCopy";
import { api, type StarryBinding } from "../api";
import { useViewMode } from "../viewMode";

export type ComposerVariant = "compact" | "workspace";
export type ComposerPlacement = "hero" | "dock";

export type AttachmentRef = { id?: string; name: string; path: string; size?: number; type?: string };
type ProjectOption = { id: string; label: string; handle?: string; description?: string };

export type ComposerSubmit = {
  text: string;
  intent?: string;
  collaboration_id?: string;
  knowledge_id?: string;
  attachments?: AttachmentRef[];
  model_tier?: string;
  entities?: Record<string, unknown>;
  scope?: ComposerScope;
  object_refs?: ComposerObjectRef[];
  client_entry?: ComposerClientEntry;
};

export type ComposerSuggestion = {
  label?: string;
  prompt?: string;
  intent?: string;
};

export type SkillOption = CatalogSkill;

function labelOf(s: SkillOption): string {
  return labelOfSkill(s);
}

function triggerQuery(value: string, caret: number): { start: number; q: string; mark: "/" | "@" } | null {
  const before = value.slice(0, caret);
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch !== "/" && ch !== "@") continue;
    if (i > 0 && !/\s/.test(before[i - 1])) continue;
    const q = before.slice(i + 1);
    if (q.endsWith(" ") && q.trim()) return null;
    return { start: i, q, mark: ch };
  }
  return null;
}

export default function ComposerDock({
  value,
  onChange,
  onSubmit,
  disabled,
  variant = "compact",
  placement,
  onFocusChange,
  lockedIntent,
  lockedLabel,
  lockedKnowledgeId,
  lockedTemplate,
  stageCode,
  onKnowledgeChange,
  autoFocus,
  selectFirstPlaceholder,
  autoFocusToken,
  suggestions,
  onPickSuggestion,
  onPickSkill,
  running,
  queue,
  onStop,
  onRemoveQueued,
  hint,
  discoveryBrief = null,
  discoveryCatalog = null,
  discoveryOverride = false,
  showDiscoveryEditor = true,
  onDiscoveryBriefChange,
  onOpenDiscoveryTemplate,
  onClearDiscoveryLock,
  contextChips,
  entryIntent = "free",
  objectRefs = [],
  onObjectRefsChange,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (payload: ComposerSubmit) => void;
  disabled?: boolean;
  variant?: ComposerVariant;
  placement?: ComposerPlacement;
  onFocusChange?: (focused: boolean) => void;
  lockedIntent?: string | null;
  lockedLabel?: string | null;
  lockedKnowledgeId?: string | null;
  lockedTemplate?: LockedMailTemplate | null;
  stageCode?: string | null;
  onKnowledgeChange?: (row: KnowledgeRow | null) => void;
  autoFocus?: boolean;
  selectFirstPlaceholder?: boolean;
  autoFocusToken?: number;
  suggestions?: ComposerSuggestion[];
  onPickSuggestion?: (item: ComposerSuggestion) => void;
  onPickSkill?: (skill: SkillOption, ctx: { mention: string; rest: string }) => void;
  running?: boolean;
  queue?: { id: string; text?: string; intent?: string }[];
  onStop?: () => void;
  onRemoveQueued?: (id: string) => void;
  hint?: string;
  discoveryBrief?: DiscoveryBrief | null;
  discoveryCatalog?: Pick<DiscoveryTemplate, "platforms" | "regions" | "directions"> | null;
  discoveryOverride?: boolean;
  /** AI发现 tab 的页面上已有条件卡时，隐藏提问框里那套重复芯片；提交判定仍用 discoveryBrief。 */
  showDiscoveryEditor?: boolean;
  onDiscoveryBriefChange?: (brief: DiscoveryBrief) => void;
  onOpenDiscoveryTemplate?: () => void;
  onClearDiscoveryLock?: () => void;
  contextChips?: { id: string; label: string }[];
  entryIntent?: ComposerEntryIntent;
  objectRefs?: ComposerObjectRef[];
  onObjectRefsChange?: (refs: ComposerObjectRef[]) => void;
}) {
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [templates, setTemplates] = useState<KnowledgeRow[]>([]);
  const [knowledgeLibs, setKnowledgeLibs] = useState<KnowledgeLib[]>([]);
  const [connectors, setConnectors] = useState<ConnectorDto[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [recentFiles, setRecentFiles] = useState<(AttachmentRef & { available?: boolean })[]>([]);
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [atStart, setAtStart] = useState(0);
  const [triggerMark, setTriggerMark] = useState<"/" | "@">("/");
  const [pickerIndex, setPickerIndex] = useState(-1);
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attachErr, setAttachErr] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<PlusSubpanel>(null);
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null);
  const [skillChips, setSkillChips] = useState<ComposerChip[]>([]);
  const [kbChips, setKbChips] = useState<ComposerChip[]>([]);
  const [connectorChips, setConnectorChips] = useState<ComposerChip[]>([]);
  const [expertId, setExpertId] = useState(DEFAULT_EXPERT_ID);
  const [dragging, setDragging] = useState(false);
  const [modelTier, setModelTier] = useState(readModelTier);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const { debug } = useViewMode();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const skillMenuRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const onKnowledgeChangeRef = useRef(onKnowledgeChange);
  const lockSourceRef = useRef<"auto" | "explicit" | null>(lockedKnowledgeId ? "explicit" : null);
  onKnowledgeChangeRef.current = onKnowledgeChange;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [mine, market] = await Promise.all([
        fetch("/api/skills").then((r) => r.json() as Promise<SkillOption[]>),
        fetch("/api/skills/market")
          .then((r) => r.json() as Promise<SkillOption[]>)
          .catch(() => [] as SkillOption[]),
      ]);
      if (cancelled) return;
      const map = new Map<string, SkillOption>();
      for (const s of [...(Array.isArray(mine) ? mine : []), ...(Array.isArray(market) ? market : [])]) {
        if (!s?.id) continue;
        if (s.granted === false) continue;
        const prev = map.get(s.id);
        const label = s.label || s.title || prev?.label || prev?.title || s.id;
        map.set(s.id, {
          ...prev,
          ...s,
          label,
          title: label,
          aliases: Array.from(new Set([...(prev?.aliases || []), ...(s.aliases || [])])),
        });
      }
      setSkills([...map.values()]);
    };
    load().catch(() => {
      if (!cancelled) setSkills([]);
    });
    fetch("/api/knowledge/composer")
      .then((r) => r.ok ? r.json() as Promise<KnowledgeRow[]> : [])
      .then((rows) => {
        if (!cancelled && Array.isArray(rows)) setTemplates(rows);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    Promise.all([
      fetch("/api/knowledge").then((r) => r.ok ? r.json() : []),
      fetch("/api/knowledge/market").then((r) => r.ok ? r.json() : []).catch(() => []),
    ]).then(([mine, market]) => {
      if (cancelled) return;
      const rows = [...(Array.isArray(mine) ? mine : []), ...(Array.isArray(market) ? market : [])] as KnowledgeRow[];
      const map = new Map<string, KnowledgeLib>();
      for (const row of rows) {
        if (!row?.id || row.status && row.status !== "published") continue;
        if (row.cited === false) continue;
        if (!row.cited && row.kind === "mail_template") continue;
        const title = String(row.title || row.id);
        map.set(row.id, {
          id: row.id,
          title,
          shortName: title.length > 8 ? `${title.slice(0, 8)}…` : title,
        });
      }
      setKnowledgeLibs([...map.values()]);
    }).catch(() => {
      if (!cancelled) setKnowledgeLibs([]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (lockedKnowledgeId && lockSourceRef.current !== "auto") {
      lockSourceRef.current = "explicit";
    }
    const wantsDefault = lockedLabel === "写合作邮件" || value.includes("写合作邮件");
    if (!wantsDefault || !templates.length) return;
    if (lockedKnowledgeId && lockSourceRef.current === "explicit") return;
    const picked = pickDefaultMailTemplate(templates, stageCode);
    if (!picked) {
      if (lockSourceRef.current === "auto" && lockedKnowledgeId) {
        lockSourceRef.current = null;
        onKnowledgeChangeRef.current?.(null);
      }
      return;
    }
    if (picked.id === lockedKnowledgeId) return;
    lockSourceRef.current = "auto";
    onKnowledgeChangeRef.current?.(picked);
  }, [lockedKnowledgeId, lockedLabel, templates, stageCode, value]);

  useEffect(() => {
    void Promise.all([
      fetch("/api/connectors").then((r) => r.ok ? r.json() : []),
      api.starryBinding().catch(() => ({ bound: false, status: "unbound" } as StarryBinding)),
      fetch("/api/projects").then((r) => r.ok ? r.json() : []),
      fetch("/api/files/recent?limit=12").then((r) => r.ok ? r.json() : []),
    ]).then(([connectorRows, binding, projectRows, fileRows]) => {
      if (Array.isArray(connectorRows)) {
        const mapped = preferCanonicalConnectors(
          connectorRows
            .filter((row: { id?: string }) => row.id)
            .map((row: Record<string, unknown>) => {
              const id = String(row.id);
              const status = connectorUseStatus(id, binding);
              return {
                id,
                label: connectorUseLabel(id, row.label || row.name),
                access: connectorUseAccess(row.access),
                expired: status.key === "expired",
              } satisfies ConnectorDto;
            }),
        );
        setConnectors(mapped);
      }
      if (Array.isArray(projectRows)) setProjects(projectRows);
      if (Array.isArray(fileRows)) setRecentFiles(fileRows);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!plusOpen && !skillMenuOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (plusOpen && !menuRef.current?.contains(target)) {
        setPlusOpen(false);
        setActiveSubmenu(null);
      }
      if (skillMenuOpen && !skillMenuRef.current?.contains(target)) setSkillMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPlusOpen(false);
        setActiveSubmenu(null);
        setSkillMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [plusOpen, skillMenuOpen]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const min = variant === "workspace" ? 24 : 20;
    // The ceiling lives in CSS (--composer-text-max) so the box and the editor
    // can never disagree about where growth stops.
    const cap = Number.parseFloat(getComputedStyle(textarea).maxHeight);
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, min), Number.isFinite(cap) ? cap : 336)}px`;
  }, [value, variant]);

  useEffect(() => {
    const sync = () => setModelTier(readModelTier());
    window.addEventListener(MODEL_TIER_EVENT, sync);
    return () => window.removeEventListener(MODEL_TIER_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!skills.length) return;
    refreshAt(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills]);

  useEffect(() => {
    if (!autoFocus) return;
    const delay = window.setTimeout(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      if (!selectFirstPlaceholder) return;
      const match = node.value.match(/\[[^\]]+\]/);
      if (match && match.index != null) {
        node.setSelectionRange(match.index, match.index + match[0].length);
      }
    }, 350);
    return () => window.clearTimeout(delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, autoFocusToken]);

  useEffect(() => {
    const apply = (draft: ComposerDraftStash) => {
      if (draft.text) onChange(draft.text);
      if (draft.chips?.length) {
        setSkillChips(draft.chips.filter((chip) => chip.kind === "skill"));
        setKbChips(draft.chips.filter((chip) => chip.kind === "kb"));
        setConnectorChips(draft.chips.filter((chip) => chip.kind === "connector"));
        const expert = draft.chips.find((chip) => chip.kind === "expert");
        if (expert) setExpertId(expert.id);
      }
      if (draft.attachments?.length) setAttachments(draft.attachments);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    const stashed = peekComposerDraft();
    if (stashed) {
      apply(takeComposerDraftStash() || stashed);
    }
    const onDraft = (event: Event) => {
      const draft = (event as CustomEvent<ComposerDraftStash>).detail;
      if (draft) apply(draft);
    };
    window.addEventListener(COMPOSER_DRAFT_EVENT, onDraft);
    return () => window.removeEventListener(COMPOSER_DRAFT_EVENT, onDraft);
    // Apply a stashed draft once on mount; parent text remains the source of truth after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lockedSkill = lockedIntent && lockedIntent !== DISCOVERY_INTENT
    ? skills.find((s) => s.id === lockedIntent) || (lockedIntent ? {
      id: lockedIntent,
      title: lockedLabel || lockedIntent,
      label: lockedLabel || lockedIntent,
    } : undefined)
    : undefined;

  const railChips = useMemo(() => {
    const chips: ComposerChip[] = [];
    // 发现任务不再出芯片：正文首行已经是【发现任务】，芯片只是重复一遍标签，还白占
    // 一行高度。解除锁定的入口移到工具栏的「清除发现条件」。
    const seenSkills = new Set<string>();
    for (const chip of skillChips) {
      if (seenSkills.has(chip.id)) continue;
      seenSkills.add(chip.id);
      chips.push(chip);
    }
    if (lockedSkill && !seenSkills.has(lockedSkill.id)) {
      chips.push({
        kind: "skill",
        id: lockedSkill.id,
        label: lockedLabel || labelOf(lockedSkill),
        write: isWriteSkill(lockedSkill),
      });
    }
    if (lockedKnowledgeId) {
      const title = lockedTemplate?.title || templates.find((row) => row.id === lockedKnowledgeId)?.title || "资料";
      chips.push({
        kind: "kb",
        id: lockedKnowledgeId,
        label: title.length > 8 ? `${title.slice(0, 8)}…` : title,
      });
    }
    for (const chip of kbChips) {
      if (chip.id === lockedKnowledgeId) continue;
      chips.push(chip);
    }
    if (expertId !== DEFAULT_EXPERT_ID) {
      chips.push({ kind: "expert", id: expertId, label: expertChipLabel(expertId) });
    }
    chips.push(...connectorChips);
    for (const file of attachments) {
      chips.push({
        kind: "attachment",
        id: file.path,
        label: file.name,
        path: file.path,
        size: file.size,
        type: file.type,
      });
    }
    if (selectedProject) {
      chips.push({ kind: "project", id: selectedProject.id, label: selectedProject.label });
    }
    for (const ref of objectRefs) {
      chips.push({
        kind: "object",
        id: ref.id,
        label: ref.label || ref.id,
        objectKind: ref.kind,
      });
    }
    for (const chip of contextChips || []) {
      if (chips.some((item) => item.id === chip.id && item.kind === "object")) continue;
      chips.push({
        kind: "object",
        id: chip.id,
        label: chip.label,
        objectKind: "context",
      });
    }
    return chips;
  }, [
    attachments,
    connectorChips,
    contextChips,
    discoveryBrief,
    entryIntent,
    expertId,
    kbChips,
    lockedIntent,
    lockedKnowledgeId,
    lockedLabel,
    lockedSkill,
    lockedTemplate,
    objectRefs,
    selectedProject,
    skillChips,
    templates,
  ]);

  const filtered = skills.filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const blob = `${s.id} ${labelOf(s)} ${(s.aliases || []).join(" ")}`.toLowerCase();
    return blob.includes(q) || labelOf(s).toLowerCase().startsWith(q);
  });
  const filteredTemplates = templates.filter((row) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const blob = `${row.id} ${row.title} ${row.skill_id || ""} ${row.starter || ""}`.toLowerCase();
    return blob.includes(q);
  });
  const filteredConnectors = debug && triggerMark === "@" ? connectors.filter((connector) => {
    const q = query.trim().toLowerCase();
    return !q || `${connector.id} ${connector.label}`.toLowerCase().includes(q);
  }) : [];
  const pickerRows = useMemo(
    () => [
      ...filteredTemplates.map((row) => ({ kind: "template" as const, row })),
      ...filteredConnectors.map((connector) => ({ kind: "connector" as const, connector })),
      ...filtered.map((skill) => ({ kind: "skill" as const, skill })),
    ],
    [filtered, filteredConnectors, filteredTemplates],
  );
  const activePicker = pickerIndex >= 0 && pickerIndex < pickerRows.length ? pickerIndex : -1;
  const connectorBase = filteredTemplates.length;
  const skillBase = connectorBase + filteredConnectors.length;

  useEffect(() => {
    if (!picker || activePicker < 0) return;
    pickerRef.current?.querySelector<HTMLElement>(".skill-option.is-active")?.scrollIntoView({ block: "nearest" });
  }, [picker, activePicker]);

  const refreshAt = (next: string, caret?: number) => {
    const el = inputRef.current;
    const pos = caret ?? el?.selectionStart ?? next.length;
    const hit = triggerQuery(next, pos);
    if (!hit) {
      setPicker(false);
      setPickerIndex(-1);
      setQuery("");
      return;
    }
    setTriggerMark(hit.mark);
    const q = hit.q;
    const hits = skills.filter((s) => {
      if (!q) return true;
      const blob = `${s.id} ${labelOf(s)} ${(s.aliases || []).join(" ")}`.toLowerCase();
      return blob.includes(q.toLowerCase()) || labelOf(s).toLowerCase().startsWith(q.toLowerCase());
    });
    const templateHits = templates.filter((row) => {
      if (!q) return true;
      return `${row.id} ${row.title} ${row.skill_id || ""}`.toLowerCase().includes(q.toLowerCase());
    });
    const connectorHits = debug && hit.mark === "@" && connectors.some((connector) =>
      `${connector.id} ${connector.label}`.toLowerCase().includes(q.toLowerCase()),
    );
    if (q && !hits.length && !templateHits.length && !connectorHits) {
      setPicker(false);
      setPickerIndex(-1);
      setQuery(q);
      return;
    }
    setAtStart(hit.start);
    if (q !== query) setPickerIndex(-1);
    setQuery(q);
    setPicker(true);
  };

  const closePlus = () => {
    setPlusOpen(false);
    setActiveSubmenu(null);
  };

  const focusEditor = (pos?: number) => {
    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      const at = pos ?? node.value.length;
      node.setSelectionRange(at, at);
    });
  };

  const addSkillChip = (s: SkillOption, rest = value) => {
    pushRecentSkill(s.id);
    setSkillChips((current) => {
      if (current.some((chip) => chip.id === s.id)) return current;
      if (current.length >= COMPOSER_MAX_SKILL_CHIPS) return current;
      return [...current, { kind: "skill", id: s.id, label: labelOf(s), write: isWriteSkill(s) }];
    });
    onPickSkill?.(s, { mention: labelOf(s), rest });
    closePlus();
    setSkillMenuOpen(false);
    setPicker(false);
    setQuery("");
    focusEditor();
  };

  const pickSkill = (s: SkillOption) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, atStart);
    const after = value.slice(caret);
    const next = `${before}${after}`.replace(/\s+/g, " ").trimStart();
    onChange(next);
    lockSourceRef.current = null;
    onKnowledgeChange?.(null);
    addSkillChip(s, next);
  };

  const pickTemplate = (row: KnowledgeRow) => {
    const fill = composerFillText(row);
    lockSourceRef.current = "explicit";
    onChange(fill);
    onKnowledgeChange?.(row);
    setPicker(false);
    setQuery("");
    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      const match = fill.match(/\[[^\]]+\]/);
      if (match && match.index != null) node.setSelectionRange(match.index, match.index + match[0].length);
    });
  };

  const pickConnector = (connector: ConnectorDto) => {
    if (connector.expired) return;
    setConnectorChips((current) => (
      current.some((chip) => chip.id === connector.id)
        ? current
        : [...current, { kind: "connector", id: connector.id, label: connector.label, access: connector.access }]
    ));
    setPicker(false);
    closePlus();
    focusEditor();
  };

  const reuseRecentFile = (file: AttachmentRef & { available?: boolean }) => {
    if (file.available === false) return;
    setAttachments((current) => current.some((item) => item.path === file.path) ? current : [...current, file]);
    closePlus();
  };

  const attachFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    setUploading(true);
    setAttachErr("");
    try {
      const next: AttachmentRef[] = [...attachments];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch("/api/attachments", { method: "POST", body: fd });
        const b = (await r.json().catch(() => ({}))) as AttachmentRef & { detail?: string };
        if (!r.ok || !b.path) {
          throw new Error(typeof b.detail === "string" ? b.detail : "附件未写入磁盘");
        }
        const uploaded = { id: b.id, name: b.name || file.name, path: b.path, size: b.size || file.size, type: b.type || file.type || "文件", available: true };
        next.push(uploaded);
        setRecentFiles((current) => [uploaded, ...current.filter((item) => item.path !== uploaded.path)].slice(0, 12));
      }
      setAttachments(next);
    } catch (e) {
      setAttachErr(String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      if (imageRef.current) imageRef.current.value = "";
    }
  };

  const removeChip = (chip: ComposerChip) => {
    if (chip.kind === "skill") {
      setSkillChips((current) => current.filter((item) => item.id !== chip.id));
      return;
    }
    if (chip.kind === "kb") {
      setKbChips((current) => current.filter((item) => item.id !== chip.id));
      if (chip.id === lockedKnowledgeId) {
        lockSourceRef.current = null;
        onKnowledgeChange?.(null);
      }
      return;
    }
    if (chip.kind === "expert") {
      setExpertId(DEFAULT_EXPERT_ID);
      return;
    }
    if (chip.kind === "connector") {
      setConnectorChips((current) => current.filter((item) => item.id !== chip.id));
      return;
    }
    if (chip.kind === "attachment") {
      setAttachments((current) => current.filter((item) => item.path !== chip.id));
      return;
    }
    if (chip.kind === "project") {
      setSelectedProject(null);
      return;
    }
    if (chip.kind === "object") {
      onObjectRefsChange?.(objectRefs.filter((item) => item.id !== chip.id));
      return;
    }
    if (chip.kind === "discovery") {
      onClearDiscoveryLock?.();
    }
  };

  const setComposerFocus = (next: boolean) => {
    setFocused(next);
    onFocusChange?.(next);
  };

  const intent = entryIntent !== "free" ? entryIntent : undefined;
  const lockedRow = templates.find((row) => row.id === lockedKnowledgeId);
  const previewTitle = lockedRow?.title || lockedTemplate?.title || "";
  const previewSubject = lockedRow?.subject || lockedTemplate?.subject || "";
  const previewBody = lockedRow?.body_en || lockedRow?.body || lockedTemplate?.body_en || "";
  const previewExcerpt = templateBodyExcerpt(previewBody);
  const bodyInComposer = composerHoldsTemplateBody(value, previewBody);
  const discoveryLocked = entryIntent === "discover" || lockedIntent === DISCOVERY_INTENT || Boolean(discoveryBrief);
  const discoveryReady = Boolean(discoveryBrief && canSubmitDiscovery(discoveryBrief));
  const discoveryBlocked = Boolean(discoveryBrief && !canSubmitDiscovery(discoveryBrief));
  const canSend = Boolean(
    value.trim()
    || attachments.length
    || discoveryReady
    || skillChips.length
    || lockedSkill
  );
  const busy = disabled || uploading;
  const sendDisabled = !running && (busy || !canSend || discoveryBlocked);
  const workspace = variant === "workspace";
  const placeholder = hint && !value.trim() ? hint : COMPOSER_PLACEHOLDER;
  const sendState = running ? "stop" : canSend && !sendDisabled ? "ready" : "idle";

  const submit = () => {
    if (running || sendDisabled) return;
    const text = value.trim()
      || attachments.map((a) => a.name).join("、")
      || railChips.filter((chip) => chip.kind === "skill").map((chip) => chip.label).join("、")
      || "";
    const scope: ComposerScope = {
      skills: railChips.filter((chip) => chip.kind === "skill").map((chip) => chip.id),
      knowledge_bases: railChips.filter((chip) => chip.kind === "kb").map((chip) => chip.id),
      expert_id: expertId,
      connectors: connectorChips
        .filter((chip): chip is Extract<ComposerChip, { kind: "connector" }> => chip.kind === "connector")
        .map((chip) => ({
          id: chip.id,
          label: chip.label,
          access: chip.access || "write",
        })),
      intent: entryIntent,
    };
    onSubmit({
      text,
      intent,
      collaboration_id: selectedProject?.id,
      knowledge_id: lockedKnowledgeId || kbChips[0]?.id || undefined,
      model_tier: modelTier,
      attachments: attachments.length ? attachments : undefined,
      scope,
      object_refs: objectRefs,
      client_entry: clientEntryFor(entryIntent),
    });
    setAttachments([]);
    setSelectedProject(null);
    setPicker(false);
    setAttachErr("");
  };

  const shellClass = [
    "composer",
    workspace ? "composer--workspace" : "",
    placement === "hero" ? "composer--hero" : "",
    placement === "dock" || (workspace && placement !== "hero") ? "composer--dock" : "",
    plusOpen ? "is-plus-open" : "",
    focused ? "is-focused" : "",
    running ? "is-streaming" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={"composer-dock" + (dragging ? " is-dragging" : "") + (workspace ? " composer-dock--workspace" : "")}
      data-composer
      data-composer-size={variant}
      data-composer-placement={placement || (workspace ? "dock" : "compact")}
      data-composer-running={running ? "true" : undefined}
      data-composer-hint={hint || undefined}
      data-composer-discovery={discoveryLocked ? "true" : undefined}
      aria-busy={busy || running || undefined}
      onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void attachFiles(e.dataTransfer.files); }}
    >
      {dragging && (
        <div className="drop-overlay drop-overlay--sticky" role="status">
          <div className="sticky-note">
            <span className="sticky-note-pin" aria-hidden />
            <strong>贴这里就行</strong>
            <span>{debug ? "松开上传附件 · 走 Host 会话，不造本地执行" : "松开即可上传附件"}</span>
          </div>
        </div>
      )}
      {picker && (
        <div
          className="skill-picker"
          ref={pickerRef}
          data-skill-picker
          role="listbox"
          aria-label="技能"
          aria-activedescendant={activePicker >= 0 ? `skill-picker-option-${activePicker}` : undefined}
        >
          {skills.length === 0 && templates.length === 0 && <p className="muted skill-picker-empty">加载技能…</p>}
          {skills.length + templates.length > 0 && filtered.length === 0 && filteredTemplates.length === 0 && filteredConnectors.length === 0 && <p className="muted skill-picker-empty">没有匹配项</p>}
          {filteredTemplates.map((row, i) => (
            <button
              key={`kb-${row.id}`}
              type="button"
              id={`skill-picker-option-${i}`}
              className={"skill-option" + (i === activePicker ? " is-active" : "")}
              aria-selected={i === activePicker}
              data-knowledge-option={row.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickTemplate(row)}
            >
              <span className="skill-option-label">{row.title}</span>
              <span className="skill-option-id">已启用模板 · {skillLabel(row.skill_id)}</span>
            </button>
          ))}
          {filteredConnectors.map((connector, i) => (
            <button
              key={`connector-${connector.id}`}
              type="button"
              id={`skill-picker-option-${connectorBase + i}`}
              className={"skill-option" + (connectorBase + i === activePicker ? " is-active" : "")}
              aria-selected={connectorBase + i === activePicker}
              data-connector-option={connector.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickConnector(connector)}
            >
              <span className="skill-option-label">@{connector.label}</span>
              <span className="skill-option-id">连接器</span>
            </button>
          ))}
          {filtered.map((s, i) => (
            <button
              key={s.id}
              type="button"
              id={`skill-picker-option-${skillBase + i}`}
              className={"skill-option" + (skillBase + i === activePicker ? " is-active" : "")}
              aria-selected={skillBase + i === activePicker}
              data-skill-option={s.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickSkill(s)}
            >
              <span className="skill-option-label">{labelOf(s)}</span>
              <span className="skill-option-id">{isWriteSkill(s) ? "需确认" : "技能"}</span>
            </button>
          ))}
        </div>
      )}
      {discoveryOverride && discoveryLocked ? (
        <p className="composer-override-hint" data-discovery-override-hint role="status">
          {DISCOVERY_CHIP_OVERRIDE_HINT}
        </p>
      ) : null}
      {discoveryBrief && showDiscoveryEditor ? (
        <DiscoveryConditionEditor
          brief={discoveryBrief}
          catalog={discoveryCatalog}
          onChange={(next) => onDiscoveryBriefChange?.(next)}
        />
      ) : null}
      {lockedKnowledgeId && (previewTitle || previewBody) ? (
        <aside
          className={"composer-template-preview" + (bodyInComposer ? " composer-template-preview--lock" : "")}
          data-knowledge-preview={lockedKnowledgeId}
          data-knowledge-preview-mode={bodyInComposer ? "lock" : "full"}
          aria-label="已锁定邮件底稿"
        >
          <div className="composer-template-preview-head">
            <strong data-knowledge-preview-title>{previewTitle || "已启用模板"}</strong>
            {previewSubject ? (
              <span className="composer-template-preview-subject">{previewSubject}</span>
            ) : null}
          </div>
          {!bodyInComposer && previewExcerpt ? (
            <p className="composer-template-preview-excerpt" data-knowledge-preview-body>
              {previewExcerpt}
            </p>
          ) : null}
          {!bodyInComposer && previewBody && previewBody !== previewExcerpt ? (
            <details>
              <summary>全文</summary>
              <pre>{previewBody}</pre>
            </details>
          ) : null}
        </aside>
      ) : null}
      {queue && queue.length > 0 ? (
        <div className="composer-queue" data-run-queue>
          {queue.map((item) => (
            <span key={item.id} className="queue-chip" data-queue-id={item.id}>
              <span>{String(item.text || "排队中的任务").slice(0, 28)}</span>
              <button
                type="button"
                className="chip-x"
                aria-label="移出队列"
                onClick={() => onRemoveQueued?.(item.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {attachErr && <p className="error composer-err">{attachErr}</p>}
      {suggestions && suggestions.length > 0 ? (
        <div className="composer-suggestions" data-ai-next-actions data-composer-suggestions>
          {suggestions.slice(0, 3).map((item, index) => {
            const label = item.label || `建议 ${index + 1}`;
            return (
              <button
                key={`${item.intent || label}-${index}`}
                type="button"
                data-ai-next={item.intent || ""}
                disabled={disabled}
                onClick={() => {
                  if (onPickSuggestion) {
                    onPickSuggestion(item);
                    return;
                  }
                  onChange(String(item.prompt || item.label || ""));
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
      <form
        className={shellClass}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ChipRail chips={railChips} onRemove={removeChip} />
        <input
          ref={fileRef}
          type="file"
          hidden
          data-attach-input
          multiple
          onChange={(e) => attachFiles(e.target.files)}
        />
        <input
          ref={imageRef}
          type="file"
          hidden
          accept="image/*"
          data-attach-image
          multiple
          onChange={(e) => attachFiles(e.target.files)}
        />
        <textarea
          ref={inputRef}
          data-composer-input
          data-ai-prompt-textarea
          data-composer-hint={hint || undefined}
          aria-busy={busy || undefined}
          readOnly={Boolean(running)}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            refreshAt(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyUp={() => refreshAt(value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setPicker(false);
              return;
            }
            if (e.key === "Backspace" && !value && railChips.length && !composing) {
              e.preventDefault();
              removeChip(railChips[railChips.length - 1]);
              return;
            }
            if (
              picker
              && (e.key === "ArrowDown" || e.key === "ArrowUp")
              && pickerRows.length
              // 输入法用上下键选候选词，组合期间不抢键
              && !composing
              && !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setPickerIndex((current) => {
                const total = pickerRows.length;
                const base = current < 0 || current >= total ? (step > 0 ? -1 : 0) : current;
                return (base + step + total) % total;
              });
              return;
            }
            if (e.key === "Enter" && picker && pickerRows.length) {
              e.preventDefault();
              const picked = pickerRows[activePicker >= 0 ? activePicker : 0];
              if (picked.kind === "connector") pickConnector(picked.connector);
              else if (picked.kind === "template") pickTemplate(picked.row);
              else pickSkill(picked.skill);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !composing && !picker) {
              e.preventDefault();
              submit();
            }
          }}
          onFocus={() => {
            setComposerFocus(true);
            refreshAt(value);
          }}
          onBlur={(e) => {
            if (!e.currentTarget.form?.contains(e.relatedTarget as Node)) setComposerFocus(false);
          }}
          onClick={() => refreshAt(value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              void attachFiles(files);
            }
          }}
          rows={1}
          placeholder={placeholder}
          aria-label="发消息或创建任务"
        />
        <div className="composer-toolbar" data-ai-prompt-tools>
          <div className="composer-add-wrap" ref={menuRef}>
            <button
              type="button"
              className={"composer-plus" + (plusOpen ? " is-selected" : "")}
              data-attach
              aria-label="添加资料"
              title="添加资料"
              disabled={busy || running}
              aria-expanded={plusOpen}
              onClick={() => {
                setPlusOpen((v) => !v);
                setSkillMenuOpen(false);
                setActiveSubmenu(null);
              }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                <path
                  d="M12 5v14M5 12h14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <PlusMenu
              open={plusOpen}
              submenu={activeSubmenu}
              onSubmenu={setActiveSubmenu}
              onClose={closePlus}
              onUploadFile={() => fileRef.current?.click()}
              onUploadImage={() => imageRef.current?.click()}
              onOpenDiscovery={onOpenDiscoveryTemplate}
              onPickSkill={(skill) => addSkillChip(skill)}
              onPickKb={(row) => {
                setKbChips((current) => (
                  current.some((chip) => chip.id === row.id)
                    ? current
                    : [...current, { kind: "kb", id: row.id, label: row.shortName }]
                ));
                closePlus();
                focusEditor();
              }}
              onPickConnector={pickConnector}
              onPickExpert={(id) => {
                setExpertId(id);
                closePlus();
                focusEditor();
              }}
              onPickProject={(project) => {
                setSelectedProject(project);
                closePlus();
                focusEditor();
              }}
              onReuseFile={reuseRecentFile}
              skills={skills}
              knowledgeLibs={knowledgeLibs}
              connectors={connectors}
              recentFiles={recentFiles}
              projects={projects}
              selectedSkillIds={skillChips.map((chip) => chip.id)}
              expertId={expertId}
            />
          </div>
          <div className="composer-skill-wrap" ref={skillMenuRef}>
            <button
              type="button"
              className={"composer-skill-trigger" + (skillMenuOpen ? " is-selected" : "")}
              data-composer-skill-trigger
              data-composer-skill-trigger-open={skillMenuOpen ? "true" : "false"}
              aria-haspopup="menu"
              aria-expanded={skillMenuOpen}
              disabled={busy || running}
              onClick={() => {
                setSkillMenuOpen((v) => !v);
                setPlusOpen(false);
                setActiveSubmenu(null);
              }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                <path
                  d="M5 5h5v5H5zm9 0h5v5h-5zM5 14h5v5H5zm9 0h5v5h-5z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>技能</span>
              <span className="composer-skill-caret" aria-hidden>⌄</span>
            </button>
            {skillMenuOpen ? (
              <div
                className="menu-popover composer-add-menu compose-skill-menu"
                role="menu"
                aria-label="技能"
                data-composer-skill-menu
              >
                <SkillMenu
                  skills={skills}
                  selectedSkillIds={skillChips.map((chip) => chip.id)}
                  onPick={(skill) => addSkillChip(skill)}
                  onClose={() => setSkillMenuOpen(false)}
                />
              </div>
            ) : null}
            {discoveryLocked && onClearDiscoveryLock ? (
              <button
                type="button"
                className="composer-discovery-clear"
                data-composer-discovery-clear
                title="清除发现条件，退回普通提问"
                onClick={() => onClearDiscoveryLock()}
              >
                清除发现条件
              </button>
            ) : null}
          </div>
          <div className="composer-toolbar-end">
            <ModelTierControl className="composer-toolbar-tier" compact />
            {running ? (
              <button
                className="btn send send-arrow is-stop"
                type="button"
                data-stop-run
                data-send
                data-send-state="stop"
                aria-label="停止生成"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onStop?.();
                }}
              >
                <span className="composer-stop-square" aria-hidden />
              </button>
            ) : (
              <button
                className={"btn send send-arrow" + (sendState === "ready" ? " is-ready" : " is-idle")}
                type="submit"
                data-send
                data-ai-prompt-submit
                data-send-state={sendState}
                disabled={sendDisabled}
                aria-label="发送"
              >
                <SendArrowIcon ready={sendState === "ready"} />
              </button>
            )}
          </div>
        </div>
      </form>
      <span className="sr-only" role="status">{uploading ? "正在上传附件" : attachErr || ""}</span>
    </div>
  );
}

function SendArrowIcon({ ready }: { ready: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden data-send-arrow={ready ? "ready" : "idle"}>
      <path
        d="M12 19V6m0 0-5.5 5.5M12 6l5.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DiscoveryConditionEditor({
  brief,
  catalog,
  onChange,
}: {
  brief: DiscoveryBrief;
  catalog?: Pick<DiscoveryTemplate, "platforms" | "regions" | "directions"> | null;
  onChange: (brief: DiscoveryBrief) => void;
}) {
  const platforms = catalog?.platforms?.length ? catalog.platforms : OVERSEAS_DISCOVERY_PLATFORMS;
  const regions = catalog?.regions?.length ? catalog.regions : DISCOVERY_REGION_OPTIONS;
  const directions = catalog?.directions?.length ? catalog.directions : DISCOVERY_DIRECTION_PACKS;
  const atMax = brief.directions.length >= MAX_DISCOVERY_DIRECTIONS;
  return (
    <div className="discovery-composer-conditions" data-discovery-condition-editor aria-label="发现条件">
      <div className="discovery-filter-group" data-discovery-filter="platform">
        <span className="discovery-filter-title">平台</span>
        <div className="discovery-chip-row">
          {platforms.map((option) => (
            <button
              key={option.code}
              type="button"
              className="discovery-chip"
              data-discovery-chip={option.code}
              aria-pressed={brief.platforms.includes(option.code)}
              onClick={() => onChange({
                ...brief,
                platforms: brief.platforms[0] === option.code ? [] : [option.code as DiscoveryPlatformCode],
              })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="discovery-filter-group" data-discovery-filter="region">
        <span className="discovery-filter-title">地区</span>
        <div className="discovery-chip-row">
          {regions.map((option) => (
            <button
              key={option.code}
              type="button"
              className="discovery-chip"
              data-discovery-chip={option.code}
              aria-pressed={brief.region === option.code}
              onClick={() => onChange({ ...brief, region: option.code })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="discovery-filter-group" data-discovery-filter="directions">
        <span className="discovery-filter-title">方向</span>
        <div className="discovery-chip-row">
          {directions.map((option) => {
            const code = option.code as DiscoveryDirectionCode;
            const pressed = brief.directions.includes(code);
            return (
              <button
                key={option.code}
                type="button"
                className="discovery-chip"
                data-discovery-chip={option.code}
                data-discovery-preset={option.code}
                aria-pressed={pressed}
                disabled={atMax && !pressed}
                onClick={() => {
                  const next = toggleDirection(brief.directions, code).directions;
                  onChange({
                    ...brief,
                    directions: next,
                    keywords: keywordsForDirections(next, directions),
                  });
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {atMax ? <p className="discovery-direction-limit" role="status">最多添加 8 个方向</p> : null}
      </div>
    </div>
  );
}

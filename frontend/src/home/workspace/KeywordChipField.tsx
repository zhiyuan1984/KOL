import { useCallback, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { DISCOVERY_DIRECTION_PACKS, keywordsForDirections } from "../discoveryTemplate";

/**
 * 关键词芯片控件（仅 AI发现 条件卡使用）。
 * 规则：回车添加、英文短语里的空格不拆、大小写不敏感去重（保留首次输入形态）、
 * 逗号/顿号仍可一次输出多个词；中文输入法选字期间不添加。
 * 容器随芯片换行增高，不做内部滚动；候选来自方向包关键词去重。
 */

const EMPTY_WORDS: string[] = [];
const DRAFT_SEPARATOR = /[,，、]/;
const OPTION_LIMIT = 8;

/** 去重与比较用的键：大小写不敏感，首尾空格不算数。 */
export function keywordKey(word: string): string {
  return String(word ?? "").trim().toLowerCase();
}

/** 逗号/顿号把草稿拆成多个词；空格属于英文短语本身，不拆。 */
export function splitKeywordDraft(raw: string): string[] {
  return String(raw ?? "").split(DRAFT_SEPARATOR).map((item) => item.trim()).filter(Boolean);
}

/** 追加草稿里的词，跳过空词与重复词（大小写不敏感）。 */
export function addKeywordDraft(words: string[], raw: string): string[] {
  const next = (Array.isArray(words) ? words : EMPTY_WORDS).map((word) => String(word ?? "").trim()).filter(Boolean);
  const seen = new Set(next.map(keywordKey));
  for (const word of splitKeywordDraft(raw)) {
    const key = keywordKey(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(word);
  }
  return next;
}

/** 提交前把输入框里未确认的草稿并入有效关键词（flushDraft 的纯逻辑）。 */
export function flushKeywordDraft(words: string[], draft: string): string[] {
  return addKeywordDraft(words, draft);
}

/** 只删掉命中的那一个词，其余保持原样。 */
export function removeKeyword(words: string[], word: string): string[] {
  const key = keywordKey(word);
  const next = (Array.isArray(words) ? words : EMPTY_WORDS).filter((item) => keywordKey(item) !== key);
  return next.length === (Array.isArray(words) ? words.length : 0) ? words : next;
}

/** 候选 = 方向包关键词去重（已选词不再出现；有关键字时按包含匹配过滤）。 */
export function filterKeywordOptions(
  options: string[],
  words: string[],
  query = "",
  limit = OPTION_LIMIT,
): string[] {
  const selected = new Set((Array.isArray(words) ? words : EMPTY_WORDS).map(keywordKey));
  const needle = keywordKey(query);
  const next: string[] = [];
  for (const raw of Array.isArray(options) ? options : EMPTY_WORDS) {
    const word = String(raw ?? "").trim();
    const key = keywordKey(word);
    if (!key || selected.has(key)) continue;
    if (needle && !key.includes(needle)) continue;
    if (next.some((item) => keywordKey(item) === key)) continue;
    next.push(word);
    if (next.length >= limit) break;
  }
  return next;
}

/** 方向包的全部关键词（去重、保持包顺序），作为芯片候选的默认来源。 */
export function discoveryKeywordOptions(packs = DISCOVERY_DIRECTION_PACKS): string[] {
  return keywordsForDirections(packs.map((pack) => pack.code), packs);
}

const DEFAULT_OPTIONS = discoveryKeywordOptions();

export type KeywordChipFieldHandle = {
  /** 把输入框里还没回车的词并入芯片；返回合并后的完整关键词列表。 */
  flushDraft: () => string[];
};

export default function KeywordChipField({
  value,
  onChange,
  options = DEFAULT_OPTIONS,
  label = "关键词",
  placeholder = "输入关键词，回车添加",
  pristine,
  invalid,
  ref,
}: {
  value: string[];
  onChange?: (words: string[]) => void;
  /** 候选词：默认取发现方向包的关键词去重。 */
  options?: string[];
  label?: string;
  placeholder?: string;
  pristine?: boolean;
  invalid?: boolean;
  ref?: Ref<KeywordChipFieldHandle>;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const composingRef = useRef(false);
  const listId = `${useId()}options`;
  const words = Array.isArray(value) ? value : EMPTY_WORDS;
  const candidates = useMemo(() => filterKeywordOptions(options, words, draft), [draft, options, words]);

  const applyWords = useCallback((next: string[]) => {
    setDraft("");
    setActiveIndex(-1);
    if (next.length !== words.length) onChange?.(next);
  }, [onChange, words]);

  const flushDraft = useCallback(() => {
    const next = flushKeywordDraft(words, draft);
    setDraft("");
    setActiveIndex(-1);
    if (next.length !== words.length) onChange?.(next);
    return next;
  }, [draft, onChange, words]);

  useImperativeHandle(ref, () => ({ flushDraft }), [flushDraft]);

  const optionId = (index: number) => `${listId}-${index}`;
  const activeOption = open && activeIndex >= 0 ? candidates[activeIndex] : undefined;
  const listShown = open && candidates.length > 0;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 中文输入法选字期间的回车只用于确认候选字，不在这里加词。
    if (composingRef.current || event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!candidates.length) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        if (current < 0) return event.key === "ArrowDown" ? 0 : candidates.length - 1;
        const step = event.key === "ArrowDown" ? 1 : -1;
        return (current + step + candidates.length) % candidates.length;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeOption) applyWords(addKeywordDraft(words, activeOption));
      else applyWords(addKeywordDraft(words, draft));
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div className="ai-discovery-text-control is-keyword-control" data-discovery-keywords-control data-discovery-keywords>
      {words.map((word, index) => (
        <span className="discovery-keyword-chip" data-discovery-keyword-chip={word} key={`${keywordKey(word)}-${index}`}>
          {word}
          <button type="button" className="chip-x" data-discovery-keyword-remove aria-label={`删除关键词 ${word}`}
            onClick={() => applyWords(removeKeyword(words, word))}>×</button>
        </span>
      ))}
      <input className="ai-discovery-input" data-discovery-keywords-input type="text" role="combobox"
        aria-label={label} aria-invalid={invalid} data-discovery-pristine={pristine ? "true" : "false"}
        aria-expanded={listShown} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={activeOption ? optionId(activeIndex) : undefined}
        autoComplete="off" spellCheck={false} placeholder={placeholder} value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActiveIndex(-1);
        }}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          setDraft(event.currentTarget.value);
        }} />
      {words.length || draft ? <button type="button" className="discovery-keyword-clear" data-discovery-clear-keywords
        aria-label="清除关键词" onClick={() => applyWords(EMPTY_WORDS)}>×</button> : null}
      {listShown ? (
        <ul className="discovery-keyword-options" data-discovery-keyword-options role="listbox" id={listId} aria-label={`${label}候选`}>
          {candidates.map((word, index) => (
            <li key={`${keywordKey(word)}-${index}`} id={optionId(index)} role="option" data-discovery-keyword-option={word}
              className={"discovery-keyword-option" + (index === activeIndex ? " is-active" : "")}
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyWords(addKeywordDraft(words, word))}>{word}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

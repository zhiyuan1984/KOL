import { SKILL_LABEL } from "./knowledgeCopy";

/**
 * 员工面文案的唯一清洗入口（DESIGN §15：员工表面不显示 MCP、工具 ID、内部 schema）。
 * 页面上的正文、卡片与过程行都过这一套，调试原文除外。
 */

/** 远端执行面名称：整段换成业务词，避免只删 "MCP" 后留下「Starry KOL  连接器」这类残句。 */
const ENGINE_SURFACE = /\b(?:starry\s*kol(?:\s*mcp)?|starrykol)\b/gi;
/** `starrykol.previewEmailDraft` 这类点分工具名整体丢弃。 */
const DOTTED_TOOL = /\b(?:starrykol|starry)\.[A-Za-z0-9_.]+\b/gi;
/** 调用别名，如 rt_9f2c1a。 */
const TOOL_ALIAS = /\b(?:rt|call|tool|span|run|req|res)_[a-z0-9]{3,}\b/gi;
const ENGINE_WORD = /\b(?:mcp|codex)\b/gi;
/** thread / skill 在英文信件里是普通词，只有夹在中文里时才是引擎术语。 */
const ENGINE_WORD_IN_CJK = /(?<=[\u4e00-\u9fff][ \t]*)(?:skill|thread)\b|\b(?:skill|thread)(?=[ \t]*[\u4e00-\u9fff])/gi;
const SNAKE_ID = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi;
/** 只把引擎命名空间里的 snake_case 当技能 id；英文正文的 best_regards、product_name 不动。 */
const SKILL_ID_LIKE =
  /^(?:creator|email|reply|risk|deal|confirm|stage|business|crawler|skill|kol|mail|task|runtime|run|rt|tool|agent)_/;

const CJK = "\\u4e00-\\u9fff";
const CJK_GAP = new RegExp(`([${CJK}])[ \\t]+([${CJK}])`, "g");

function skillCopy(id: string): string {
  const key = id.toLowerCase();
  if (key === "crawler_collect") return "候选线索整理";
  if (SKILL_LABEL[key]) return SKILL_LABEL[key];
  return SKILL_ID_LIKE.test(key) ? "" : id;
}

export function stripEngineCopy(text: string): string {
  const source = String(text || "");
  if (!source) return "";
  return source
    .replace(DOTTED_TOOL, "")
    .replace(ENGINE_SURFACE, "数据")
    .replace(TOOL_ALIAS, "")
    .replace(SNAKE_ID, (id) => skillCopy(id))
    .replace(ENGINE_WORD, "")
    .replace(ENGINE_WORD_IN_CJK, "")
    .replace(CJK_GAP, "$1$2")
    .replace(CJK_GAP, "$1$2")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([，。、；：！？）】」…])/g, "$1")
    .replace(/[（【「][ \t]+/g, "$1")
    .replace(/^[ \t]+/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

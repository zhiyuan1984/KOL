import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..", "..", "data", "kol");

function read(name) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) throw new Error(`missing canonical KOL source: ${file}`);
  return fs.readFileSync(file, "utf8");
}

function row(line) {
  return line.split("|").slice(1, -1).map((cell) => cell.trim());
}

function table(markdown, name) {
  const lines = markdown.split(/\r?\n/).filter((line) => line.startsWith("|"));
  if (lines.length < 3) throw new Error(`${name} does not contain a Markdown table`);
  const headers = row(lines[0]);
  const separator = row(lines[1]);
  if (separator.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
    throw new Error(`${name} has an invalid Markdown table separator`);
  }
  return lines.slice(2).map((line, index) => {
    const cells = row(line);
    if (cells.length !== headers.length) throw new Error(`${name} row ${index + 3} has ${cells.length} cells, expected ${headers.length}`);
    return Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || ""]));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const portraits = table(read("红人画像信息表.md"), "红人画像信息表.md");
const mailboxes = table(read("邮箱-负责人绑定清单.md"), "邮箱-负责人绑定清单.md");
const mainFlow = table(read("邮件模板与关键字段清单-一-KOL合作主流程识别表.md"), "主流程表");
const longTerm = table(read("邮件模板与关键字段清单-二-长期合作与异常阶段识别表.md"), "长期合作表");
const rules = read("邮件模板与关键字段清单-三-Agent判断合作阶段核心规则.md");

const expectedStages = [
  "初步接触", "已回复-有兴趣", "合作评估", "报价待确认", "商务谈判", "方案待确认",
  "合同签署", "待寄样", "已发货", "已签收-测试中", "内容策划", "内容审核",
  "待发布", "已发布", "结算中/已付款",
];

assert(portraits.length === 5, `portrait rows: expected 5, got ${portraits.length}`);
assert(new Set(portraits.map((item) => item["名称"])).size === portraits.length, "portrait names must be unique");
assert(mailboxes.length === 22, `mailbox rows: expected 22, got ${mailboxes.length}`);
assert(mainFlow.length === 15, `main flow rows: expected 15, got ${mainFlow.length}`);
assert(longTerm.length === 10, `long-term/exception rows: expected 10, got ${longTerm.length}`);
assert(mainFlow.every((item) => expectedStages.includes(item["阶段"])), "main flow contains an unknown official stage");
assert(new Set(mainFlow.map((item) => item["阶段"])).size === expectedStages.length, "main flow must cover each official stage once");
assert(mailboxes.every((item) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item["邮箱地址"])), "mailbox binding contains an invalid email");
assert(mailboxes.every((item) => item["品牌归属"] && item["负责人姓名"] && item["部门"]), "mailbox binding has an incomplete scope row");
assert(rules.includes("正文明确动作 > 附件和链接 > 履约字段 > 邮件主题"), "stage evidence precedence rule is missing");

console.log(JSON.stringify({
  source: path.relative(path.resolve(root, "..", ".."), root),
  portraits: portraits.length,
  mailboxBindings: mailboxes.length,
  mainFlowStages: mainFlow.length,
  longTermAndExceptionRules: longTerm.length,
  status: "valid",
}, null, 2));

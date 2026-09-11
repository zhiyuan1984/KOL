# 生产级真实数据夹具

来源（不要改成编造的 demo 名）：

1. **Starry KOL MCP** 测试机 `http://47.251.65.112:9091/mcp`（2026-09-03 快照）
   - `starry-kol-profiles.json`：`listAllKolProfiles` 220 条白名单画像
   - `starry-kol-mailboxes.json`：`pageMailboxes` 5 个真实授权邮箱
   - `starry-kol-stages.json`：`listCooperationStageOptions` 16 个阶段（含旧码）
2. **业务上传的 Markdown**（运营台账导出）
   - `红人画像信息表.md`：叶观旺跟进的 Wendell Fishing / Holly Yoo 等
   - `KOL合作主流程识别表.md`：15 个正式阶段邮件模板
   - `长期合作与异常阶段识别表.md`
   - `Agent判断合作阶段核心规则.md`：正文 > 附件 > 履约 > 主题
   - `邮箱-负责人绑定清单.md`：22 个品牌邮箱与负责人
   - `starry-kol-mcp.md`：62 个 Tool 清单

联系方式未做 `decryptKolContact`。画像快照只有白名单字段。

收发邮件矩阵（发件箱锁定 `larry.zhao@amperetime.com`）：

- `larry-zhao-email-scenarios.json`：MCP 预览/确认发送、缺字段、已移交、RO/LT 品牌不一致、邮箱占用、无明文邮箱；Host PEP From 白名单与阶段信门禁；入站判阶（正文 > 附件 > 履约 > 主题）+ 异常/长期。
- 自动化：`backend/tests/larry-zhao-email-scenarios.test.ts`

刷新 MCP 快照（测试机可达时）：

```bash
cd backend && npx tsx scripts/snapshot-starry-kol.ts
```


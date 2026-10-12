# 管理端知识：PPTX 支持实施登记

## 需求与审查

- **需求**：管理端知识直接上传、拖入和替换 `.pptx`，不再要求用户手动转换 PDF。
- **主责角色**：平台产品经理确认用户提出的格式拓展；架构师选择 LibreOffice 的确定性转换；前后端专家实现；测试经理验证。
- **宪法**：CONST-04（不重写业务权限）、CONST-05（原审批边界保持）、CONST-06（原件、版本和来源保留）、CONST-08（本记录）、CONST-10（验证与上线严格区分）。
- **技术基本法**：TECH-ARCH-01/04、TECH-FE-01/03、TECH-BE-01/02/08、TECH-TEST-01/02/03。
- **结论**：符合。上传和转换不使资料自动成为员工可用知识；仍需范围核对与现有发布审批。没有改宪法或基本法正文。
- **状态**：本地验证后提交评审，未部署，未合并。功能分支基于上传 bug 修复分支，对应 PR #235；此格式拓展为后续独立 PR。

## 实现

1. 前端批量上传、入库页及草稿原件替换接受 `.pptx`（大小写扩展名兼容）。旧 `.ppt` 提示另存为 PPTX。
2. 后端按 OOXML 包结构验证，拒绝伪装 ZIP/PDF、宏、加密、缺失幻灯片、XML 实体声明、外链媒体及超限容器。普通超链接保留为惰性链接。
3. LibreOffice Impress 使用独立临时 profile、关闭宏、headless 导出 PDF，包含隐藏幻灯片；PDF 页数必须等于原幻灯片数，失败不会提交索引。
4. 原 PPTX 保留。`converted.pdf` 是原版逐页视觉预览；`normalized.pdf` 是索引输入。图片、图表或无文本页复用现有视觉 OCR；OCR 规整可重排，但每张索引 PDF 页都映射到原幻灯片页。
5. `extracted.md` 保存逐页文本。问答引用与知识范围证据共享原页码映射；缺失映射不伪造页码。
6. 管理端 `/file` 下载原 PPTX，`/preview` 显示逐页 PDF；员工已发布资料引用打开视觉预览。两个入口继续走既有授权链。
7. 原生与旧审批材料纳入原 PPTX、索引规整 PDF、原版预览 PDF 的指纹；预览文件被替换后不可当作既定审批材料展示或发布。
8. 取消和超时杀整个转换进程组，等待关闭后清理临时文件；stdout 文本上限 16 MiB，超限明确失败，不截断后入库。

## 部署前置

### Linux/systemd 部署

```bash
sudo apt-get update
sudo apt-get install -y libreoffice-impress fonts-noto-cjk poppler-utils python3 python3-venv
python3 -m venv /opt/knowledge-python
/opt/knowledge-python/bin/pip install -r backend/tools/pageindex-bridge/requirements.txt
```

按服务器权限选择虚拟环境目录；配置 `KNOWLEDGE_PAGEINDEX_PYTHON` 指向实际解释器。上方安装示例需要对应系统管理权限，并非本次已在线上执行。

可选环境变量：

```dotenv
KNOWLEDGE_LIBREOFFICE_BIN=libreoffice
KNOWLEDGE_PPTX_TIMEOUT_MS=300000
KNOWLEDGE_PAGEINDEX_PYTHON=/opt/knowledge-python/bin/python
```

- 默认转换超时5分钟，配置最高30分钟。超大演示文稿可拆分后重试。
- `Dockerfile` 已加入 LibreOffice Impress、中文字体、PDF 工具和桥接 Python 虚拟环境；本地没有 Docker daemon，本次未执行镜像构建。
- 视觉 OCR、PageIndex 建索引及知识范围提炼仍使用现有部署的模型与凭据。缺依赖或模型故障如实失败，不模拟生产结果。
- 本次没有调用服务器部署脚本、没有修改线上知识、没有代用户发布审批。

## 可重复验证

```bash
# 无外部模型调用；实际本地 LibreOffice 转换需要系统依赖
cd backend
TEST_PPTX_CONVERSION=1 npx vitest run tests/knowledge-pptx.test.ts tests/knowledge-document-pages.test.ts

# 需要仅供测试的 PostgreSQL URL，数据库会在临时命名空间创建/清理
TEST_DATABASE_URL=<test-postgres-url> TEST_PPTX_CONVERSION=1 \
  npx vitest run tests/knowledge-documents.test.ts -t PPTX
TEST_POSTGRES_URL=<test-postgres-url> \
  npx vitest run tests/knowledge-publication.postgres.integration.test.ts
npm run typecheck

cd ../frontend
npm run test:knowledge
npm run build
npm run typecheck
```

回归夹具 `backend/tests/fixtures/pptx/` 为合成资料，不是用户华为文档，也不包含原书/课件内容。2页与116页样本含隐藏页和中文文字；混合3页样本含文字页、标题加图片页和纯图片页。

**证据边界**：真实 LibreOffice 与本地 Python 渲染/文本型 PDF 被实际执行；混合页 OCR 响应和 PageIndex 索引在接口测试中受控替换，未据此宣称线上 OCR、知识问答或实际华为116页文档已经成功。当前会话未取得用户原 PPTX 字节。

## 已知限制

- 动画、视频、演讲者备注不作为动态内容执行；以每张幻灯片的静态 PDF 展示与可识别内容为准。特殊字体与复杂排版仍需管理员核对视觉预览。
- 旧二进制 `.ppt`、宏启用 `.pptm` 和受密码保护的文件不支持；另存为标准 `.pptx`。
- 图片和图表页 OCR 质量依赖现有视觉模型；须人工核对范围与原文后审批。页面继承于母版的复杂图像对象可能需另行验证。
- 完整 `knowledge-documents.test.ts` 存在本次修改前即有的4项失败：技能负责人夹具、旧知识检索审批断言2项、删除后403/404权限断言差异；没有为消除这些失败而修改权限或审批规则。
- 本地验证不是生产发布；合并、部署依赖安装和原始文件验收应按现有发布流程实施。

## 验证结果（2026-10-12）

- 前端知识组件回归：67/67 通过；PPTX上传与预览组件最终重跑12/12通过。
- 前端 `npm run build`、前后端 `npm run typecheck` 通过。
- 真实 LibreOffice 转换、格式拒绝、超时/取消及OPC部件兼容：13/13通过，含116页样本。
- 页码映射：4/4通过；混合PPTX接口测试使用长OCR文本跨多张规整PDF页，检索返回第2张以上规整页时正确映射到原幻灯片第2页。
- 原生PostgreSQL审批回归：16/16通过，含PPTX逐页预览、跨组织拒绝和预览字节变化拒绝。
- `validate:contracts`、`validate:registry`、`git diff --check` 通过。
- 新增当前页面浏览器回归 `-g PPTX`：1/1通过，保留原件下载和独立PDF预览、零发布写入。
- 旧 `knowledge-ingest-presentation.spec.ts` 的6条既有用例失败：夹具还查找当前页面已移除的引擎健康标识、行内更多菜单、旧嵌入上传表单与加工结果位置。保留失败记录，未为它们恢复旧页面或改写既有断言。这些用例并未证明当前知识模块整体E2E通过。
- 本地无 Docker daemon，未执行容器构建；原始华为PPTX未获取，未验证其具体字体、图片内容与版式。

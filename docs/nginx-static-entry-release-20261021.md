# nginx 静态入口发布与恢复（2026-10-21）

## 边界

本改动仅承载 SPA 与发布流程，不改变业务对象、权限、SOP、审批或 API 语义。nginx 从 `/var/www/lingong/ui/current` 读取页面；`current` 指向 `releases/<完整Git SHA>`，`previous` 保存上一版。静态目录不得指向 `/home` 或仓库。

`/api`、`/api/`、`/mock`、`/mock/` 真实代理 `127.0.0.1:8765`；API 不可用时仍返回真实 502，不伪造成功。HTML 与 `/release.json` 禁止缓存；共享 `/assets` hash 池仅追加且一年 immutable。其他 public 文件 no-cache，缺失 JS/JSON 等资源 404，不回落 HTML。

## 首次迁移顺序

先完成数据库与 nginx 配置私有备份。以 `ecs-user` 从干净仓库执行：

```bash
bash scripts/bootstrap-nginx-static-entry.sh --deploy-user ecs-user
sudo bash scripts/bootstrap-nginx-static-entry.sh --apply --deploy-user ecs-user
```

**已有线上页面时，必须在 nginx reload 前将当前已部署 `frontend/dist` 原样复制到旧版本静态 release，生成 manifest 和完整 SHA 元数据，并建立 current。不得先安装空静态目录，造成首次迁移 404。** 复制前校验旧版 `release.json.commit` 等于实际生产提交；拒绝构建目录内的符号链接。旧版 hash assets 同步到共享池，既有同名文件内容不一致则停止。release 文件设为 0444、目录 0555，验证 `sha256sum -c manifest.sha256`，nginx 用户能读取 index 后才继续。

```bash
sudo install -o root -g root -m 0644 ops/nginx/app.conf /etc/nginx/conf.d/app.conf
sudo nginx -t && sudo systemctl reload nginx
```

若配置测试或页面验证失败，恢复已备份 app.conf 并再次 nginx -t/reload；不修改其他站点或公开仓库目录。

## 固定版本部署

快进到已验证的精确主干 SHA，不强制 reset、不忽略本体治理提醒。先执行必要的幂等 schema 升级，再发布：

```bash
bash scripts/apply-postgres-schema.sh
bash scripts/deploy.sh
```

发布脚本保留锁、五个 systemd unit 路径检查、显式 Cron 恢复策略和 ontology gate。前端在旧 API 仍服务时构建；完整 SHA release 附 `release.json` 和 `manifest.sha256`。只有五个单元均 active 且真实 PostgreSQL/native/Codex 健康契约通过，才记录发布基线、原子保存 previous、切换 current、更新 `frontend/dist/release.json`。启动脚本不再安装依赖、重建原生模块或构建前端。

健康失败时旧页面继续提供，API 错误保持真实；不自动回滚数据库。磁盘按完整 release 加一份新 assets 和至少 256 MiB 保留量检查，不通过则不激活。

## 静态回退

只回退静态页面，不代表后端或数据库已恢复：

```bash
cd /var/www/lingong/ui
TARGET="$(readlink previous)"
case "$TARGET" in releases/*) ;; *) exit 1;; esac
(cd "$TARGET" && sha256sum -c manifest.sha256)
ln -s "$TARGET" ".current.rollback.$$"
mv -Tf ".current.rollback.$$" current
```

切换后验证根、业务地图深链、版本元数据及旧 hash。后端回退须先验证 schema 向后兼容，并使用原生产 SHA、同一 systemd 路径及私有备份；数据库恢复单独审批，不自动执行。

## 验证与事实声明

```bash
TEST_LOG_DIR=/tmp/lingong-entry-tests bash scripts/test-nginx-static-entry.sh
```

隔离测试覆盖 upstream 可用/不可用时页面 200、四种 API/mock 断开时 502、资源 MIME/cache、缺失资源 404、旧 hash 保留、权限、previous 与原子静态回退。隔离测试不证明生产已部署。生产实际发布另记录精确提交、migration count、五单元运行状态、真实健康 JSON、外部页面/资源/权限检查和部署期间观测；不得把登录重定向当成已登录功能验收。

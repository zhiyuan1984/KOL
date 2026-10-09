#!/usr/bin/env bash
set -euo pipefail
ROOT=/home/ecs-user/kol
PAYLOAD=/home/ecs-user/kol/backups/knowledge-page-JvaO5AYf242Sm9aPewqcVa/payload
BACKUP=/home/ecs-user/kol/backups/knowledge-page-JvaO5AYf242Sm9aPewqcVa
cd "$ROOT"
sha256sum -c "$PAYLOAD/baseline.sha256"
sha256sum -c "$PAYLOAD/e2e-baseline.sha256"
for file in IngestDocumentDetails.tsx IngestDocumentDetails.test.tsx; do
  test ! -e "frontend/src/admin/knowledge/$file"
done
mkdir -p "$BACKUP/original/frontend/src/admin/knowledge" "$BACKUP/original/frontend/e2e"
for file in IngestView.tsx KnowledgeHome.tsx knowledge-admin.css; do
  cp -p "frontend/src/admin/knowledge/$file" "$BACKUP/original/frontend/src/admin/knowledge/$file"
done
cp -p frontend/e2e/admin-knowledge-presentation.spec.ts "$BACKUP/original/frontend/e2e/"
tar czf "$BACKUP/frontend-dist-before.tgz" -C frontend dist
systemctl show -p MainPID --value lingong > "$BACKUP/backend-pid-before.txt"
for file in IngestView.tsx KnowledgeHome.tsx knowledge-admin.css IngestDocumentDetails.tsx IngestDocumentDetails.test.tsx; do
  cp "$PAYLOAD/frontend/src/admin/knowledge/$file" "frontend/src/admin/knowledge/$file"
done
cp "$PAYLOAD/frontend/e2e/admin-knowledge-presentation.spec.ts" frontend/e2e/
echo '已完成限定文件备份和更新；生产前端仍在提供旧版本。'
cd frontend
VITE_OUT_DIR=dist.knowledge-JvaO5AYf242Sm9aPewqcVa npm run build
test -s dist.knowledge-JvaO5AYf242Sm9aPewqcVa/index.html
# 先复制带哈希资源，再原子替换入口；旧资源保留给已打开页面，不重启后端。
cp -a dist.knowledge-JvaO5AYf242Sm9aPewqcVa/assets/. dist/assets/
cp dist.knowledge-JvaO5AYf242Sm9aPewqcVa/index.html dist/index.html.knowledge-new
mv dist/index.html.knowledge-new dist/index.html
cd "$ROOT"
sha256sum frontend/src/admin/knowledge/IngestView.tsx frontend/src/admin/knowledge/KnowledgeHome.tsx frontend/src/admin/knowledge/knowledge-admin.css frontend/src/admin/knowledge/IngestDocumentDetails.tsx > "$BACKUP/deployed-source.sha256"
systemctl show -p MainPID --value lingong > "$BACKUP/backend-pid-after.txt"
cmp "$BACKUP/backend-pid-before.txt" "$BACKUP/backend-pid-after.txt"
curl -fsS http://127.0.0.1:8765/api/health
printf '\n前端已更新；未重启后端。备份：%s\n' "$BACKUP"

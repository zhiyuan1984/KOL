# FS-KOL-007 爬虫 Job

范围：异步启动、查询、停止和重试采集任务。非目标：同步伪装完成、绕过导入审批。

输入：平台、模式、关键词或 creator IDs、公司/品牌范围、幂等键。输出：Job、状态事件、结果文件、导入候选和失败原因。

规则：BR-JOB-001 `start → status → result → upload`；BR-IDEMP-002 同一批次不重复导入；BR-IMPORT-001 导入是独立副作用。

实现引用：`mediacrawler.start_crawl`、`get_crawl_status`、`get_creators`、`upload_creators`、`import_creator`。

验收（TEST-KOL-007）：超时可停止和重试；上传失败保留批次；未确认不写 Starry 主库。

评价：EVAL-KOL-006、EVAL-KOL-007。

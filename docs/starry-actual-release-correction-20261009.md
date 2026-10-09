# Starry 诊断部署路径纠正（2026-10-09）

## 原因与证据

用户于 11:07 报告：`已跟进，但 Starry 入库未完成：档案未回传红人编号，未加入公海。。`

只读审计确认，11:07:08（北京时间）Outdoor Boys 的失败事件为 `host.import_creator.failed`，候选频道 `UCfpCQ89W9wjkHc8J_6eTbBg`，原因 `missing_kol_uid`，审计中没有 `starry_response` 字段。

此前补丁已写入 `/home/ecs-user/kol`，该工作区源码校验和正确且服务重启，但 systemd 的 `99-main-release.conf` 覆盖了主服务和 Worker 的工作目录及执行路径，实际使用 `/home/ecs-user/kol-releases/56fef12b`。只检查工作区源码及健康响应不能证明目标进程加载了补丁；此前报告「线上诊断已生效」证据不足，应予纠正。

## 当前对象状态

- 本地候选显示名称：Outdoor Boys。
- `kol_follow_index`：操作者 `sriphy` 的跟进为 `active`。
- 本地编号为 `candidate:youtube:<频道ID>`，不是已确认的正式 Starry 编号。
- `discovery_runtime_imports`：`uncertain`，没有正式 `kol_uid`。
- 以该操作者身份进行只读 `listAllKolProfiles`，回包包含 239 条档案，未找到频道 ID 或名称的匹配记录。
- 没有重发建档或导入，也不据此宣称 Starry 永远没有该对象。
- 旧执行未保存业务回包，无法从那条审计恢复当时的错误原文，不猜测为邮箱占用或参数缺失。

## 修正方案

- 诊断增量补丁必须应用到 systemd 实际使用的发布目录；不更改账号权限、不切换整个仓库或版本。
- 使用现有发布与连接器部署锁，防止覆盖同时进行的前端工作。
- 保留该发布目录原有连接器界面等修改；备份原始源码与前端产物。
- 去掉候选跟进部分成功提示的重复末尾标点。
- 发布前在真实目录跑 TypeScript 检查和 28 个回包/身份核对单元用例；前端在旧进程仍服务时构建。
- 发布后检查每个服务的 `WorkingDirectory/ExecStart/MainPID` 与 `/proc/<pid>/cwd`，核对真实目录源码校验和与健康响应。
- 不把模拟错误写入生产审计作为验收证据，不在没有用户确认的情况下重新入库原候选。

## 审查

需求 → 主责角色（后端专家、前端专家、测试经理） → CONST-05/06/08/10 → BIZ-01/10、TECH-BE-03/07/08、TECH-TEST-03/04 → **符合**：修正部署路径与诊断证据，不改变跟进归属、业务权限和正式写入确认规则 → 下一步：真实目录部署验证后，用户对原对象执行「加入公海」确认，再按新审计定位实际回包。

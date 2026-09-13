# FS-KOL-001 达人发现与画像只读

范围：按关键词、平台、阶段、风险和品牌范围查询画像并展示来源。非目标：解密联系方式、导入、改负责人、改阶段。

输入：`company_id`、组织/品牌/区域范围、关键词或 `kolUid`。输出：画像、平台数据、当前阶段、风险标签、负责人、来源时间；缺 UID 时进入补充态。

规则：BR-KOL-001 只读；BR-SCOPE-001 对象必须在授权范围；BR-SECRET-001 不返回明文联系方式。

实现引用：`creator_discovery`、`creator_profile`、`starrykol.pageKolProfiles`、`starrykol.getKolProfileDetail`、`starrykol.listKolPlatformData`。

验收（TEST-KOL-001）：给定授权品牌画像时返回来源和范围；给定跨品牌画像时拒绝；给定无 UID 时不猜测。

评价：EVAL-KOL-001、EVAL-KOL-003。

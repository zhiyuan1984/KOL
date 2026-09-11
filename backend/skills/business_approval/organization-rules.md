# Organization rules

Source of employees and mailboxes: `backend/tests/fixtures/real-data/邮箱-负责人绑定清单.md`.
All listed owners are 推广部 / 在职. Shared LT Europe mailboxes belong to both 李伟瑜 and 古佳睿.

**Manager edges are explicit seed facts** (not guessed from the table):

```
张总（GM）
 └── 王主管（推广部负责人）
      ├── 林桐（PQ品牌组）── 黎玉燕
      ├── 赖逸询（RO品牌组）── 陈冰冰、余佳妮、凌嘉余
      └── 钟槿年（LT品牌组）── 叶观旺、李伟瑜、古佳睿、张干、刁楚聪、刘小丽
财务负责人 ── FUNCTIONAL / FINANCE_OWNER（向张总汇报）
```

赖逸询的代理人种子为凌嘉余（清单「移交对象」列为空时，测试用这条代理边）。
`get_manager_chain(employee_id)` is 100% deterministic. Circular edges throw.

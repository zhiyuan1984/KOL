# Examples

User (zh): 黎玉燕要申请5万美国KOL推广预算。
1. Parse: `{ requester_name: "黎玉燕", amount: 50000, currency: "CNY" }`（「5万」+ 美国预算若未写美元，按用户语言里的数字；写了美金则用 USD）
2. `web_search` 费用报销审批权限（CNY 本位币可跳过汇率搜索）
3. Staff from org binding + searched band. Cite the policy excerpt. Do not emit `FIN-EXP-003` unless that id appears in the searched text.

User (en): Please file an expense approval for 黎玉燕, 50,000 USD KOL spend.
1. Parse: `{ requester_name: "黎玉燕", amount: 50000, currency: "USD" }`
2. `web_search`：`中国人民银行 人民币汇率中间价 美元 {today}`
3. `web_search`：公司费用审批制度 / 政策公布页
4. `amount_cny = 50000 × 本轮中间价`. Cite URL + date. Do **not** use 7.2 unless that number is in this-round search results.
5. Explain in English with the searched sources.

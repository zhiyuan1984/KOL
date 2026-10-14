/**
 * 账号访问资产复制：仅使用原生异步 PostgreSQL。默认 dry-run，只读取；
 * apply 时由仓储在单个可序列化事务中完成锁定、重加密、授权复制和审计。
 */
export {
  pgCopyAccountAccess as copyAccountAccess,
  ACCOUNT_ACCESS_REASON,
  ACCOUNT_ACCESS_SOURCE,
  type AccountAccessAction,
  type AccountAccessInput,
  type AccountAccessReport,
  type AccountAccessSection,
} from "../postgres/account-access-repository.js";

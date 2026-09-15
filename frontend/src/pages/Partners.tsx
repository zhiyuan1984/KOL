import { Link } from "react-router-dom";

/** Honest stub: /partners is not a second Home followed-KOL board and not a skill mode. */
export default function Partners() {
  return (
    <div className="list-page" data-partners-page="stub">
      <div className="page-kicker">工作伙伴</div>
      <h1>工作伙伴</h1>
      <p className="muted" data-partners-lead>
        本页不是首页「我跟进的红人」，也不是技能目录。跟进中的达人请回首页处理。
      </p>
      <p>
        <Link to="/" data-partners-home>
          回首页跟进红人
        </Link>
      </p>
    </div>
  );
}

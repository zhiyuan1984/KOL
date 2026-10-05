import { useEffect, useState } from "react";
import { reviewApi, reviewCompany } from "./api";
export function ReviewOrganization() {
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>(
      [],
    ),
    [chosen, setChosen] = useState(reviewCompany()),
    [error, setError] = useState("");
  useEffect(() => {
    const explicit = new URLSearchParams(window.location.search).get(
      "reviewCompany",
    );
    if (explicit) sessionStorage.setItem("review.company", explicit);
    reviewApi<{ id: string; name: string }[]>("/approvals/v2/companies")
      .then(setCompanies)
      .catch((e) => setError(e.message));
  }, []);
  if (companies.length < 2 && !chosen)
    return error ? <p role="alert">组织列表加载失败：{error}</p> : null;
  return (
    <section className="review-toolbar" aria-label="评审组织">
      <label>
        当前组织
        <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
          <option value="">请选择组织</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={!chosen || chosen === reviewCompany()}
        onClick={() => {
          const url = new URL(window.location.href);
          url.searchParams.set("reviewCompany", chosen);
          window.location.assign(url.toString());
        }}
      >
        切换组织
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

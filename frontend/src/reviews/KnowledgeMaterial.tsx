import { useEffect, useState } from "react";
import { reviewApi, reviewCompany } from "./api";
import { Link } from "react-router-dom";
export default function KnowledgeMaterial({id}:{id:string}) {
  const [data,setData]=useState<{title:string;pages:number;version:number;publication_status:string;error:string|null;receipt:{published_at?:string}|null;management_url?:string|null}>(),[error,setError]=useState("");
  const [query,setQuery]=useState(""),[busy,setBusy]=useState(false),[answer,setAnswer]=useState<{answer?:string;scope?:string;citations?:{page:number;source_url:string}[]}>();
  async function trial(){setBusy(true);setError("");setAnswer(undefined);try{
    setAnswer(await reviewApi(`/approvals/v2/instances/${id}/knowledge/trial`,{query}));
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  useEffect(()=>{
    let live=true;
    const load=()=>reviewApi<NonNullable<typeof data>>(`/approvals/v2/instances/${id}/knowledge`).then(x=>{if(live){setData(x);setError("");}}).catch(e=>{if(live)setError(e.message);});
    void load();const timer=setInterval(()=>void load(),3000);
    return ()=>{live=false;clearInterval(timer);};
  },[id]);
  return <section aria-label="审批资料版本"><h3>知识资料</h3>
    {error && <p role="alert">{error}</p>}
    {data && <><p>{data.title} · v{data.version} · {data.pages}页</p>
      <a href={`/api/approvals/v2/instances/${id}/knowledge/file?company=${encodeURIComponent(reviewCompany())}`} target="_blank" rel="noreferrer">查看本次审批 PDF 原件</a>
      <details><summary>本次审批版本试算</summary><p>仅查询当前资料；不会发布或写入员工结果。</p>
        <label>试算问题<textarea maxLength={2000} value={query} onChange={e=>setQuery(e.target.value)} /></label>
        <button className="btn" disabled={busy || !query.trim()} onClick={()=>void trial()}>{busy ? "正在试算…" : "试算"}</button>
        {answer && <><p>{answer.scope}</p><p>{answer.answer}</p>{answer.citations?.map((c,i)=><a key={i} href={c.source_url} target="_blank" rel="noreferrer">原文第{c.page}页 </a>)}</>}
      </details>
      <p>发布状态：{({unpublished:"未发布",queued:"等待发布",publishing:"发布中",published:"已发布",failed:"发布失败",blocked:"发布受阻"} as Record<string,string>)[data.publication_status] || data.publication_status}</p>
      {data.error && <p role="alert">{data.error}</p>}
      {data.publication_status === "queued" && data.management_url && <p><Link to={data.management_url}>前往资料详情立即发布 →</Link></p>}
      {data.receipt?.published_at && <p>发布时间：{new Date(data.receipt.published_at).toLocaleString()}</p>}
    </>}
  </section>;
}

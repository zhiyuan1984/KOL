import type {KnowledgeScope} from '../../../shared/knowledge-scope';
export default function KnowledgeScopeMaterial({material,fileUrl}:{material:{explanation:string;fingerprint:string;scope:KnowledgeScope};fileUrl:string}) {
  const scope=material.scope;
  return <section aria-label="审批冻结的知识范围"><h3>本次批准后生效的知识范围</h3><p>范围指纹 {material.fingerprint.slice(0,12)} · 与本次资料共同冻结</p><p>上传解释：{material.explanation || '未填写'}</p><p>{scope.summary}</p><p>对象：{scope.entities.map(e=>e.name).join('、') || '未识别明确对象'}</p>
    {scope.topics.map((topic,index)=><p key={index}>{topic.label} · {topic.evidence_ids.flatMap(id=>scope.evidence.find(e=>e.id===id)?.original_pages || []).filter((page,i,all)=>all.indexOf(page)===i).map(page=><a key={page} href={`${fileUrl}#page=${page}`} target="_blank" rel="noreferrer">原件第{page}页 </a>)}</p>)}
    <p>限制：{scope.limitations.join('；')}</p><p>完整目录：未确认 · 正文覆盖：{scope.coverage.status==='complete'?'已处理可识别正文':'存在识别缺口'}</p>{scope.unverified_notes.length>0 && <p>待证实说明：{scope.unverified_notes.join('；')}</p>}
  </section>;
}

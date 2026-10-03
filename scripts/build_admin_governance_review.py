"""Build a clickable review from the supplied ZIP and the b8cfe46 sidebar.

The output is a local design prototype with in-memory data, not a production UI.
"""

from __future__ import annotations

import base64
import html
import re
import subprocess
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ZIP = Path(r"C:\Users\admin\Desktop\agent-admin-prototype (8).zip")
OUT = Path(r"C:\Users\admin\.codex\visualizations\2026\10\02\01a0febe-72f7-7fd2-b800-09bbb7a75753\agent-admin-review\interactive-v2")
REF = "b8cfe46"


def git_file(path: str) -> str:
    return subprocess.check_output(["git", "show", f"{REF}:{path}"], cwd=ROOT).decode("utf-8")


def icon(path: str) -> str:
    return f'<svg class="nav-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="{html.escape(path)}" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"/></svg>'


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "shell.css").write_text(git_file("frontend/src/styles.css"), encoding="utf-8")
    (OUT / "litime-logo.png").write_bytes((ROOT / "frontend/public/brand/litime-logo.png").read_bytes())
    (OUT / "Lucas6.webp").write_bytes((ROOT / "frontend/public/avatars/lucas/Lucas6.webp").read_bytes())

    nav_source = git_file("frontend/src/layout/adminNav.ts")
    groups = re.findall(r'label: "([^"]+)",\s*rows: \[(.*?)\n\s*\],', nav_source, re.S)
    nav_parts = []
    page_for_id = {"employees": "employees", "agents": "agents", "skills": "skills"}
    for group_label, body in groups:
        rows = re.findall(r'id: "([^"]+)",\s*label: "([^"]+)",\s*href: "[^"]+",\s*icon: "([^"]+)"', body)
        items = []
        for row_id, label, path in rows:
            page = page_for_id.get(row_id, "")
            items.append(f'<a href="#/{row_id}" class="nav-link{" active" if row_id == "employees" else ""}" data-nav-id="{row_id}" data-page="{page}" title="{html.escape(label)}">{icon(path)}<span class="sidebar-label">{html.escape(label)}</span></a>')
        nav_parts.append(f'<nav class="nav-group" aria-label="{html.escape(group_label)}">{"".join(items)}</nav>')

    emp_ico = "M12 3a5 5 0 0 1 0 10 5 5 0 0 1 0-10 M20 21a8 8 0 0 0-16 0"
    admin_ico = "M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"
    settings_ico = "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915 M15 12a3 3 0 0 1-6 0 3 3 0 0 1 6 0"
    logout_ico = "M16 17l5-5-5-5 M21 12H9 M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"

    outer = f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>管理侧交互评审 · {REF}</title><link rel="stylesheet" href="shell.css"><style>
html,body{{height:100%;margin:0}} .workbench{{height:100vh}} .main{{height:100vh;padding:0;overflow:hidden}} .review-frame{{border:0;width:100%;height:100%;display:block}}
.sidebar-version{{font-size:var(--ds-font-helper);color:var(--text-muted);margin-bottom:var(--space-2)}}
</style></head><body><div class="workbench admin-surface" data-ui-shell="agent-v1" data-left-width="260">
<aside class="sidebar"><div class="sidebar-head"><a class="sidebar-brand" href="#/employees"><div class="brand-lockup brand-lockup--sidebar" data-brand-lockup="sidebar"><img class="brand-logo" src="litime-logo.png" alt="Li Time"></div><picture class="sidebar-lucas" aria-hidden="true"><img src="Lucas6.webp" alt=""></picture></a><button type="button" class="sidebar-search-btn collapse-toggle" title="收起侧栏" aria-label="收起侧栏"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg></button></div>
<div class="sidebar-scroll"><div class="sidebar-nav-stack">{''.join(nav_parts)}</div></div>
<div class="sidebar-foot"><div class="sidebar-version">v {REF}</div><div class="account-bar" data-account-bar><div class="account-identity account-pedestal"><span class="account-avatar" aria-hidden="true">预</span><span class="account-copy sidebar-label"><span class="account-name">预览帐号</span></span></div><div class="account-actions"><nav class="surface-switch" aria-label="工作界面"><a class="surface-switch-seg" title="员工端" href="#/employee-surface">{icon(emp_ico)}</a><a class="surface-switch-seg" title="管理端" href="#/employees" aria-current="page">{icon(admin_ico)}</a></nav><a class="account-icon-btn" href="#/settings" aria-label="个人设置" title="个人设置">{icon(settings_ico)}</a><button class="account-icon-btn" aria-label="退出登录" title="退出登录">{icon(logout_ico)}</button></div></div></div></aside>
<main class="main"><iframe class="review-frame" id="review-frame" src="prototype.html" title="员工、Agent 与技能交互评审"></iframe></main></div>
<script>
const frame=document.querySelector('#review-frame');
function selectPage(page){{document.querySelectorAll('[data-nav-id]').forEach(a=>a.classList.toggle('active',a.dataset.page===page&&!!page));frame.contentWindow?.postMessage({{type:'review-page',page}},'*');}}
document.querySelectorAll('[data-nav-id]').forEach(a=>a.addEventListener('click',e=>{{e.preventDefault();if(a.dataset.page)selectPage(a.dataset.page);else alert('该页面不在本次三页交互评审范围内。');}}));
document.querySelector('.collapse-toggle').addEventListener('click',()=>{{document.querySelector('.workbench').classList.toggle('sidebar-collapsed');const collapsed=document.querySelector('.workbench').classList.contains('sidebar-collapsed');document.querySelector('.workbench').dataset.leftWidth=collapsed?'56':'260';}});
document.querySelectorAll('.sidebar-brand,.account-actions a,.account-actions button').forEach(a=>a.addEventListener('click',e=>{{e.preventDefault();if(a.classList.contains('sidebar-brand'))selectPage('employees');else alert('此入口沿用项目侧栏外观，不在本次评审范围内。');}}));
window.addEventListener('message',e=>{{if(e.data?.type==='review-page-changed')document.querySelectorAll('[data-nav-id]').forEach(a=>a.classList.toggle('active',a.dataset.page===e.data.page&&!!e.data.page));}});
</script></body></html>'''
    (OUT / "index.html").write_text(outer, encoding="utf-8")

    with zipfile.ZipFile(ZIP) as archive:
        prototype = archive.read("agent-admin-prototype/index.html").decode("utf-8")
    prototype = prototype.replace('<header class="topbar">', '<header class="topbar" hidden>', 1)
    prototype = re.sub(r'<div class="page-head">.*?</div>\s*</div>', '', prototype, flags=re.S)
    prototype = prototype.replace('const agCell=ba.length\n', 'const agCell=ba.length\n')
    prototype = re.sub(r'const agCell=ba.length\s*\?`<button class="acc-btn".*?:`<span style="color:var\(--text-faint\)">0 个</span>`;',
        'const agCell=ba.length ? `<button class="btn sm linklike" data-action="goto-agent" data-id="${ba[0].id}" title="${esc(ba.map(a=>a.name).join("、"))}">${esc(ba.map(a=>a.name).join("、"))}</button>` : `<span style="color:var(--text-faint)">—</span>`;', prototype, count=1, flags=re.S)
    prototype = prototype.replace('style="overflow-wrap:break-word"', 'style="white-space:nowrap"')
    prototype = prototype.replace('<span class="nm">${esc(e.name)}${e.status==="disabled"?` <span class="badge b-neutral">✕ 停用</span>`:""}</span>', '<span class="nm">${esc(e.name)}</span>')
    prototype = prototype.replace('<th>操作</th><th>最近变更</th>', '<th>操作</th>')
    prototype = prototype.replace('<td style="white-space:nowrap">${e.updated}</td></tr>`;', '</tr>`;')
    prototype = prototype.replace('colspan="7"', 'colspan="6"')

    # 筛选组改单选（2026-10-03 确认）：每组同一时刻只选中一项，选中用辅助色，不用阴影。
    # 「全部」记为全选集合，因此筛选谓词 state.X.includes(...) 无需改动。
    chip_groups = [
        ("emp-brand", "empBrands", "allB", "BRANDS", "renderEmpChips();renderEmpTable();"),
        ("emp-status", "empStatus", "allS", '["active","disabled"]', "renderEmpChips();renderEmpTable();"),
        ("agent-bind", "agentBind", "allB", "AGENT_BIND_OPTS.map(o=>o[0])", "renderAgentChips();renderAgentList();"),
        ("agent-status", "agentStatus", "allS", '["active","disabled"]', "renderAgentChips();renderAgentList();"),
        ("skill-type", "skillTypes", "allT", "SKILL_TYPE_OPTS.map(o=>o[0])", "renderSkillChips();renderSkillList();"),
        ("skill-status", "skillStatus", "allS", "SKILL_STATUS_OPTS.map(o=>o[0])", "renderSkillChips();renderSkillList();"),
    ]
    for name, field, all_flag, all_values, renders in chip_groups:
        prototype, n = re.subn(
            r'case"%s-chip":\{const \w+=el\.dataset\.id,i=state\.%s\.indexOf\(\w+\);\s*\n\s*i>=0\?[^\n]*\n\s*([^\n]*?)break;\}'
            % (name, field),
            r'case"%s-chip":state.%s=[el.dataset.id];\1break;' % (name, field),
            prototype)
        assert n == 1, f"{name}: 子项点击未按预期替换（{n} 处）"
        prototype, n = re.subn(
            r'(case"%s-all":)state\.%s=[^;]*;' % (name, field),
            r'\1state.%s=%s;' % (field, all_values),
            prototype)
        assert n == 1, f"{name}: 全选点击未按预期替换（{n} 处）"
        prototype, n = re.subn(
            r'aria-pressed="\$\{state\.%s\.includes\(' % field,
            'aria-pressed="${!%s&&state.%s.includes(' % (all_flag, field),
            prototype)
        assert n == 1, f"{name}: 选中态渲染未按预期替换（{n} 处）"

    prototype = prototype.replace('</style>', '''
/* 评审修订：各页直达内容，两栏各有一条全高滚动，新增固定在中栏底部。 */
html,body,main{height:100%;overflow:hidden} body{background:var(--surface)} main{min-width:0}
.page{height:100%;max-width:none;margin:0;padding:var(--space-3);overflow:hidden}
.topbar[hidden]{display:none!important}
.page[hidden]{display:none!important}.emp-layout{height:100%;gap:var(--space-3);align-items:stretch}
.emp-side{height:100%;max-height:none;border-radius:var(--radius-card)}
.emp-side-scroll{overflow-y:auto;scrollbar-width:thin}.emp-list-pane,.agent-detail-pane{height:100%;max-height:none;overflow-y:auto;scrollbar-width:thin;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card)}
.emp-list-pane .grid{width:100%;table-layout:fixed}.emp-list-pane .grid th,.emp-list-pane .grid td{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.emp-list-pane .grid th:nth-child(1){width:15%}.emp-list-pane .grid th:nth-child(2){width:22%}.emp-list-pane .grid th:nth-child(3){width:12%}.emp-list-pane .grid th:nth-child(4){width:10%}.emp-list-pane .grid th:nth-child(5){width:13%}.emp-list-pane .grid th:nth-child(6){width:28%}
.emp-list-pane .grid tbody tr{height:44px}.emp-list-pane .grid td .btn.sm{margin-right:2px}.emp-list-pane .emp-cell{min-width:0}.emp-list-pane .emp-cell .nm{overflow:hidden;text-overflow:ellipsis}
.emp-side .fpanel{padding-bottom:var(--space-3);border-bottom:1px solid var(--border)}.emp-side .fpanel:last-child{border-bottom:0}
:root{--chip-on-bg:color-mix(in srgb,var(--accent) 10%,#fff);--chip-on-border:color-mix(in srgb,var(--accent) 35%,transparent)}
.chip{font-size:var(--ds-font-sm);padding:0 var(--space-2);border-color:var(--border);background:var(--surface);color:var(--text-quiet)}
.chip[aria-pressed="true"]{background:var(--chip-on-bg);color:var(--accent-text);border-color:var(--chip-on-border);font-weight:600}
@media(max-width:1100px){.emp-layout{flex-direction:row}.emp-side{flex:0 0 230px;width:230px;height:100%;max-height:none}.emp-list-pane,.agent-detail-pane{height:100%;max-height:none}}
</style>''', 1)
    prototype = prototype.replace('</body>', '''<script>
window.addEventListener('message',event=>{if(event.data?.type!=='review-page')return;const page=event.data.page;const tab=document.querySelector(`[data-action="nav"][data-page="${page}"]`);if(tab)tab.click();});
document.addEventListener('click',event=>{const link=event.target.closest('[data-action="goto-agent"]');if(link)parent.postMessage({type:'review-page-changed',page:'agents'},'*');});
</script></body>''', 1)
    (OUT / "prototype.html").write_text(prototype, encoding="utf-8")
    print(OUT)


if __name__ == "__main__":
    main()

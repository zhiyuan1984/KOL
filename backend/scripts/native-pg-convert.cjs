#!/usr/bin/env node
// Offline aid only. Outputs native pg.query source; never import from application code.
// Review transactions, SQL dialects, map callbacks and cross-domain callers after conversion.
const fs = require('node:fs');
const ts = require('typescript');
const paths = process.argv.slice(2);
if (!paths.length) throw new Error('usage: node scripts/native-pg-convert.cjs <source.ts> ...');
const knownAsync = new Set(['audit', 'listAudit', 'tx']);
function sql(source) {
  let index = 0, quoted = false, out = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "'") { if (quoted && source[i+1] === "'") {out += "''"; i++; continue;} quoted = !quoted; }
    out += ch === '?' && !quoted ? `$${++index}` : ch;
  }
  out = out.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
  const insert = /INSERT\s+OR\s+(REPLACE|IGNORE)\s+INTO\s+(\w+)\s*\(([^)]+)\)/i.exec(out);
  if (insert) {
    const columns = insert[3].split(',').map(c => c.trim());
    const key = insert[2] === 'mailbox_owners' ? 'email' : 'id';
    if (!columns.includes(key)) throw new Error('Explicit conflict key required: '+insert[2]);
    out = out.replace(/INSERT\s+OR\s+(REPLACE|IGNORE)/i,'INSERT');
    out = out.trim().replace(/;$/, '') + (insert[1].toUpperCase()==='IGNORE' ? ' ON CONFLICT DO NOTHING' : ` ON CONFLICT (${key}) DO UPDATE SET ${columns.filter(c=>c!==key).map(c=>`${c}=EXCLUDED.${c}`).join(',')}`);
  }
  return out;
}
function apply(text, edits) {
  const chosen = edits.sort((a,b) => a.start-b.start || b.end-a.end);
  const flat=[]; let end=-1;
  for (const edit of chosen) if (edit.start >= end) {flat.push(edit); end=edit.end;}
  for (const edit of flat.reverse()) text=text.slice(0,edit.start)+edit.text+text.slice(edit.end);
  return text;
}
for (const path of paths) {
  let text=fs.readFileSync(path,'utf8');
  let file=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true);
  const constants=new Map();
  function constant(node) {
    if (ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isIdentifier(node)) return constants.get(node.text);
    if (ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken) {const a=constant(node.left),b=constant(node.right); if(a!==undefined&&b!==undefined)return a+b;}
    if (ts.isTemplateExpression(node)) {let s=node.head.text; for(const span of node.templateSpans){const v=constant(span.expression);if(v===undefined)return undefined;s+=v+span.literal.text;}return s;}
  }
  function collect(node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer){const v=constant(node.initializer);if(v!==undefined)constants.set(node.name.text,v);}ts.forEachChild(node,collect);}collect(file);
  const edits=[];
  const stored=new Map();
  function declarations(node) {
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer&&ts.isCallExpression(node.initializer)&&ts.isPropertyAccessExpression(node.initializer.expression)&&node.initializer.expression.name.text==='prepare') {
      const prep=node.initializer,raw=constant(prep.arguments[0]);
      if(raw===undefined)throw new Error(path+': dynamic stored SQL requires manual conversion');
      stored.set(node.name.text,{receiver:prep.expression.expression.getText(file),query:JSON.stringify(sql(raw))});
      edits.push({start:prep.getStart(file),end:prep.end,text:JSON.stringify(sql(raw))});
    }
    ts.forEachChild(node,declarations);
  }
  declarations(file);
  function visit(node) {
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)) {
      const terminal=node.expression.name.text, prep=node.expression.expression;
      if(['all','get','run'].includes(terminal)&&ts.isIdentifier(prep)&&stored.has(prep.text)) {
        const {receiver}=stored.get(prep.text),args=node.arguments.map(a=>a.getText(file)).join(',');
        const q=`(await ${receiver}.query(${prep.text}, [${args}]))`;
        edits.push({start:node.getStart(file),end:node.end,text:terminal==='get'?`${q}.rows[0]`:terminal==='all'?`${q}.rows`:q});return;
      }
      if(['all','get','run'].includes(terminal)&&ts.isCallExpression(prep)&&ts.isPropertyAccessExpression(prep.expression)&&prep.expression.name.text==='prepare') {
        const raw=constant(prep.arguments[0]);
        if(raw===undefined) throw new Error(`${path}:${file.getLineAndCharacterOfPosition(node.pos).line+1}: dynamic SQL requires manual conversion`);
        if (/strftime|json_extract|AUTOINCREMENT|PRAGMA/i.test(raw)) throw new Error(`${path}: unsupported dialect requires manual conversion`);
        const receiver=prep.expression.expression.getText(file);
        const args=node.arguments.map(a=>a.getText(file)).join(',');
        const query=`(await ${receiver}.query(${JSON.stringify(sql(raw))}, [${args}]))`;
        const result=terminal==='all'?`${query}.rows`:terminal==='get'?`${query}.rows[0]`:query;
        edits.push({start:node.getStart(file),end:node.end,text:result}); return;
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(file);text=apply(text,edits);fs.writeFileSync(path,text);
}
// Propagate awaits in the selected domain only. Cross-domain signatures are reported for integration.
for(let pass=0;pass<15;pass++) {
  let changed=false;
  for(const path of paths) {
    let text=fs.readFileSync(path,'utf8'), file=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true), edits=[];
    function hasAwait(node){if(node!==undefined && (ts.isFunctionLike(node)))return false; if(ts.isAwaitExpression(node))return true;let found=false;ts.forEachChild(node,ch=>{if(hasAwait(ch))found=true;});return found;}
    function visit(node) {
      if(ts.isFunctionLike(node)&&node.body&&hasAwait(node.body)) {
        if(node.name&&ts.isIdentifier(node.name))knownAsync.add(node.name.text);
        const parent=node.parent;if(ts.isVariableDeclaration(parent)&&ts.isIdentifier(parent.name))knownAsync.add(parent.name.text);
        if(!node.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)) {
          let start=node.getStart(file);
          if(ts.isFunctionDeclaration(node)) {const match=/\bfunction\b/.exec(text.slice(start,node.body.pos));start+=match.index;}
          edits.push({start,end:start,text:'async '});
          if(node.type&&!/^Promise</.test(node.type.getText(file)))edits.push({start:node.type.getStart(file),end:node.type.end,text:`Promise<${node.type.getText(file)}>`});
        }
      }
      if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&knownAsync.has(node.expression.text)&&!ts.isAwaitExpression(node.parent)) {
        edits.push({start:node.getStart(file),end:node.getStart(file),text:'(await '});
        edits.push({start:node.end,end:node.end,text:')'});
      }
      ts.forEachChild(node,visit);
    }
    visit(file);if(edits.length){const next=apply(text,edits);if(next!==text){changed=true;fs.writeFileSync(path,next);}}
  }
  if(!changed)break;
}
console.log('async signatures:',[...knownAsync].sort().join(', '));

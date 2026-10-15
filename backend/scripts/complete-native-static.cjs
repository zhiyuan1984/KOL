#!/usr/bin/env node
// Offline source conversion only: never imported into the running application.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=process.cwd();
const cfg=ts.readConfigFile(path.join(root,'tsconfig.json'),ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(cfg.config,ts.sys,root);
const program=ts.createProgram(parsed.fileNames,parsed.options),checker=program.getTypeChecker();
const problems=[],changes=[];
function apply(text,edits){edits.sort((a,b)=>a.start-b.start||b.end-a.end);const accepted=[];let end=-1;for(const e of edits){if(e.start>=end){accepted.push(e);end=e.end;}}for(const e of accepted.reverse())text=text.slice(0,e.start)+e.text+text.slice(e.end);return text;}
function literal(n,seen=new Set()){
 if(!n)return undefined;
 if(ts.isStringLiteralLike(n))return n.text;
 if(ts.isParenthesizedExpression(n))return literal(n.expression,seen);
 if(ts.isIdentifier(n)){const sym=checker.getSymbolAtLocation(n);if(!sym||seen.has(sym))return undefined;seen=new Set(seen);seen.add(sym);const decl=sym.valueDeclaration||sym.declarations?.[0];if(decl&&ts.isVariableDeclaration(decl))return literal(decl.initializer,seen);}
 if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.PlusToken){const a=literal(n.left,seen),b=literal(n.right,seen);if(a!==undefined&&b!==undefined)return a+b;}
 if(ts.isTemplateExpression(n)){let result=n.head.text;for(const s of n.templateSpans){const value=literal(s.expression,seen);if(value===undefined)return undefined;result+=value+s.literal.text;}return result;}
 return undefined;
}
const keys={};
for(const name of fs.readdirSync(path.join(root,'migrations')).filter(x=>x.endsWith('.sql'))){const src=fs.readFileSync(path.join(root,'migrations',name),'utf8');for(const m of src.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([\w.]+)\s*\(([\s\S]*?)\);/gi)){const body=m[2];let pk=/PRIMARY KEY\s*\(([^)]+)\)/i.exec(body)?.[1]?.split(',').map(x=>x.trim());if(!pk){const line=body.split('\n').find(x=>/PRIMARY KEY/i.test(x));const col=line?.trim().match(/^(\w+)\s+/)?.[1];if(col)pk=[col];}if(pk)keys[m[1].replace(/^public\./,'')]=pk;}}
function sql(raw){
 if(/\b(?:json_extract|json_each|strftime|AUTOINCREMENT|PRAGMA|VIRTUAL|MATCH)\b/i.test(raw))throw new Error('dialect requires explicit native rewrite');
 let i=0,quoted=false,out='';for(let p=0;p<raw.length;p++){const c=raw[p];if(c==="'"){if(quoted&&raw[p+1]==="'"){out+="''";p++;continue;}quoted=!quoted;}out+=c==='?'&&!quoted?'$'+(++i):c;}
 out=out.replace(/\bIFNULL\s*\(/gi,'COALESCE(');
 const insert=/INSERT\s+OR\s+(REPLACE|IGNORE)\s+INTO\s+(\w+)\s*\(([^)]+)\)/i.exec(out);
 if(insert){const cols=insert[3].split(',').map(c=>c.trim());out=out.replace(/INSERT\s+OR\s+(REPLACE|IGNORE)/i,'INSERT').trim().replace(/;$/,'');if(insert[1].toUpperCase()==='IGNORE')out+=' ON CONFLICT DO NOTHING';else{const pk=keys[insert[2]]||(cols.includes('id')?['id']:cols.includes('key')?['key']:null);if(!pk||pk.some(c=>!cols.includes(c)))throw new Error('explicit conflict key required');const update=cols.filter(c=>!pk.includes(c));out+=update.length?` ON CONFLICT (${pk.join(',')}) DO UPDATE SET ${update.map(c=>c+'=EXCLUDED.'+c).join(',')}`:' ON CONFLICT DO NOTHING';}}
 if(/COLLATE\s+NOCASE/i.test(out))throw new Error('case-insensitive comparison/order requires explicit rewrite');
 return out;
}
for(const file of program.getSourceFiles()){
 const relative=path.relative(root,file.fileName);
 if(relative.startsWith('..')||! /^(src|tests|mcp|scripts)\//.test(relative)||file.isDeclarationFile||relative==='scripts/complete-native-static.cjs')continue;
 let text=file.text;const edits=[],stored=new Map();let count=0;
 function warn(node,error){problems.push({file:relative,line:file.getLineAndCharacterOfPosition(node.getStart(file)).line+1,problem:error.message||String(error),expression:node.getText(file).slice(0,160)});}
 function declarations(node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer&&ts.isCallExpression(node.initializer)&&ts.isPropertyAccessExpression(node.initializer.expression)&&node.initializer.expression.name.text==='prepare'){try{const raw=literal(node.initializer.arguments[0]);if(raw===undefined)throw new Error('dynamic stored SQL');const query=sql(raw),sym=checker.getSymbolAtLocation(node.name);stored.set(sym,{receiver:node.initializer.expression.expression.getText(file),query});edits.push({start:node.initializer.getStart(file),end:node.initializer.end,text:JSON.stringify(query)});}catch(e){warn(node,e);}}ts.forEachChild(node,declarations);}
 declarations(file);
 function visit(node){
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)){
   const method=node.expression.name.text,prep=node.expression.expression;
   if(['all','get','run'].includes(method)){
    let receiver,query;
    if(ts.isIdentifier(prep)){const s=stored.get(checker.getSymbolAtLocation(prep));if(s){receiver=s.receiver;query=prep.getText(file);}}
    else if(ts.isCallExpression(prep)&&ts.isPropertyAccessExpression(prep.expression)&&prep.expression.name.text==='prepare'){try{const raw=literal(prep.arguments[0]);if(raw===undefined)throw new Error('dynamic SQL construction requires explicit parameters');query=JSON.stringify(sql(raw));receiver=prep.expression.expression.getText(file);}catch(e){warn(node,e);}}
    if(receiver&&query){const args=node.arguments.map(x=>x.getText(file)).join(',');const call=`(await ${receiver}.query(${query},[${args}]))`;edits.push({start:node.getStart(file),end:node.end,text:method==='all'?call+'.rows':method==='get'?call+'.rows[0]':call});count++;return;}
   }
   if(method==='exec'){try{const raw=literal(node.arguments[0]);if(raw===undefined)throw new Error('dynamic exec requires explicit migration/query');if(/\bCREATE\s+(?:TABLE|INDEX|VIRTUAL)|\bALTER TABLE/i.test(raw))throw new Error('DDL must move into versioned migration');const query=sql(raw);edits.push({start:node.getStart(file),end:node.end,text:`(await ${prep.getText(file)}.query(${JSON.stringify(query)}))`});count++;return;}catch(e){warn(node,e);}}
  }
  ts.forEachChild(node,visit);
 }
 visit(file);
 // Rename only retired DB imports/identifiers; no SQLite alias or runtime wrapper is introduced.
 function types(node){if(ts.isIdentifier(node)){const name=node.text;if(name==='SqliteConn'||name==='SqliteStmt'){if(name==='SqliteStmt')return;edits.push({start:node.getStart(file),end:node.end,text:'DatabaseConnection'});}if(name==='txImmediate')edits.push({start:node.getStart(file),end:node.end,text:'tx'});}ts.forEachChild(node,types);}types(file);
 const next=apply(text,edits);
 if(next!==text){fs.writeFileSync(file.fileName,next);changes.push({file:relative,queries:count});}
}
fs.writeFileSync('/tmp/kolnative-static-conversion.json',JSON.stringify({changes,remaining:problems},null,2)+'\n');
console.log(JSON.stringify({changed_files:changes.length,native_queries:changes.reduce((n,x)=>n+x.queries,0),manual_cases:problems.length,report:'/tmp/kolnative-static-conversion.json'}));

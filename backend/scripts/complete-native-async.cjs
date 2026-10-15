#!/usr/bin/env node
// Offline migration tool. It does not run queries, translate runtime SQL, or relax assertions.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=process.cwd(),manual=[];
const cfg=ts.readConfigFile(path.join(root,'tsconfig.json'),ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(cfg.config,ts.sys,root);
const sourcePaths=ts.createProgram(parsed.fileNames,parsed.options).getSourceFiles().filter(f=>!f.isDeclarationFile&&/^(src|tests|mcp|scripts)\//.test(path.relative(root,f.fileName))).map(f=>f.fileName);
function apply(text,edits){edits.sort((a,b)=>a.start-b.start||b.end-a.end);let end=-1;const out=[];for(const e of edits)if(e.start>=end){out.push(e);end=e.end;}for(const e of out.reverse())text=text.slice(0,e.start)+e.text+text.slice(e.end);return text;}
function hasAwait(node){if(ts.isAwaitExpression(node))return true;let found=false;ts.forEachChild(node,n=>{if(!ts.isFunctionLike(n)&&hasAwait(n))found=true;});return found;}
function unparen(n){while(n&&ts.isParenthesizedExpression(n))n=n.expression;return n;}
function inVoid(n){for(let p=n.parent;p&&!ts.isFunctionLike(p);p=p.parent){if(ts.isVoidExpression(p))return true;if(ts.isStatement(p))break;}return false;}
function promiseAssertion(n){let p=n;while(p.parent&&!ts.isFunctionLike(p.parent)){p=p.parent;if(ts.isCallExpression(p)&&ts.isIdentifier(p.expression)&&p.expression.text==='expect'){let chain=p;while(chain.parent&&(ts.isPropertyAccessExpression(chain.parent)||ts.isCallExpression(chain.parent)))chain=chain.parent;return /\.(rejects|resolves)\b/.test(chain.getText());}if(ts.isStatement(p))break;}return false;}
const collectionNames={filter:'asyncFilter',some:'asyncSome',every:'asyncEvery',find:'asyncFind',findIndex:'asyncFindIndex',forEach:'asyncForEach'};
for(let pass=0;pass<7;pass++){
 let total=0;
 // First normalize actual await-containing functions, preserving getters/constructors for manual repair.
 for(const name of sourcePaths){let text=fs.readFileSync(name,'utf8'),file=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true),edits=[];
  function visit(n){if(ts.isFunctionLike(n)&&n.body&&(hasAwait(n.body)||n.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword))){if(ts.isConstructorDeclaration(n)||ts.isGetAccessorDeclaration(n)||ts.isSetAccessorDeclaration(n)){manual.push({file:path.relative(root,name),line:file.getLineAndCharacterOfPosition(n.getStart(file)).line+1,problem:'async constructor/accessor requires explicit API change'});}else{
    if(!n.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)){let at=n.getStart(file);if(ts.isFunctionDeclaration(n)||ts.isFunctionExpression(n)){const m=/\bfunction\b/.exec(text.slice(at,n.body.pos));at+=m.index;}else if(ts.isMethodDeclaration(n))at=n.name.getStart(file);edits.push({start:at,end:at,text:'async '});}
    if(n.type&&!/^Promise\s*</.test(n.type.getText(file))){if(ts.isTypePredicateNode(n.type)){manual.push({file:path.relative(root,name),problem:'async type predicate requires explicit refinement'});}else edits.push({start:n.type.getStart(file),end:n.type.end,text:'Promise<Awaited<'+n.type.getText(file)+'>>'});}
   }}ts.forEachChild(n,visit);}
  visit(file);if(edits.length){fs.writeFileSync(name,apply(text,edits));total+=edits.length;}
 }
 const program=ts.createProgram(parsed.fileNames,parsed.options),checker=program.getTypeChecker();
 function isPromise(type){if(!type)return false;if(type.isUnion?.())return type.types.some(isPromise);return Boolean(checker.getPromisedTypeOfPromise(type));}
 function callbackAsync(n){if(!n)return false;const signatures=checker.getTypeAtLocation(n).getCallSignatures();return signatures.some(s=>isPromise(checker.getReturnTypeOfSignature(s)));}
 for(const name of sourcePaths){const file=program.getSourceFile(name);if(!file)continue;let text=file.text,edits=[],imports=new Set();
  function warn(n,problem){manual.push({file:path.relative(root,name),line:file.getLineAndCharacterOfPosition(n.getStart(file)).line+1,problem});}
  function visit(n){
   if(ts.isCallExpression(n)){
    if(ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='toThrow'){
     let exp=n.expression.expression,negative=false;while(ts.isPropertyAccessExpression(exp)){if(exp.name.text==='not')negative=true;exp=exp.expression;}
     if(ts.isCallExpression(exp)&&ts.isIdentifier(exp.expression)&&exp.expression.text==='expect'&&exp.arguments.length===1&&callbackAsync(exp.arguments[0])){if(negative){warn(n,'async not.toThrow requires explicit unchanged no-rejection assertion');}else{const fn=exp.arguments[0].getText(file),args=n.arguments.map(x=>x.getText(file)).join(',');edits.push({start:n.getStart(file),end:n.end,text:`(await expect((${fn})()).rejects.toThrow(${args}))`});return;}}
    }
    if(ts.isIdentifier(n.expression)&&n.expression.text==='expect'&&n.arguments.length===1){const arg=unparen(n.arguments[0]);if(arg&&ts.isAwaitExpression(arg)&&promiseAssertion(arg)){edits.push({start:arg.getStart(file),end:arg.end,text:arg.expression.getText(file)});return;}}
    if(ts.isPropertyAccessExpression(n.expression)&&n.arguments.length&&callbackAsync(n.arguments[0])){
     const method=n.expression.name.text,receiver=n.expression.expression,kind=checker.getTypeAtLocation(receiver);
     const isArray=Boolean(kind.getProperty('length')&&checker.getIndexTypeOfType(kind,ts.IndexKind.Number));
     if(isArray&&method==='map'){
      const parent=unparen(n.parent);const inAll=parent&&ts.isCallExpression(parent)&&ts.isPropertyAccessExpression(parent.expression)&&parent.expression.expression.getText(file)==='Promise'&&['all','allSettled'].includes(parent.expression.name.text);
      if(!inAll){edits.push({start:n.getStart(file),end:n.end,text:`(await Promise.all(${n.getText(file)}))`});return;}
     }else if(isArray&&collectionNames[method]){const helper=collectionNames[method];imports.add(helper);edits.push({start:n.getStart(file),end:n.end,text:`(await ${helper}(${receiver.getText(file)},${n.arguments.map(x=>x.getText(file)).join(',')}))`});return;
     }else if(isArray&&['sort','reduce','flatMap'].includes(method))warn(n,'async '+method+' requires explicit ordering/accumulator transformation');
    }
    const signature=checker.getResolvedSignature(n);
    if(signature&&isPromise(checker.getReturnTypeOfSignature(signature))&&!ts.isAwaitExpression(n.parent)&&!inVoid(n)&&!promiseAssertion(n)&&!isPromise(checker.getContextualType(n))){
     let parent=n.parent;
     if(ts.isPropertyAccessExpression(parent)&&['then','catch','finally'].includes(parent.name.text)) {ts.forEachChild(n,visit);return;}
     if(ts.isPropertyAccessExpression(n.expression)&&['then','catch','finally'].includes(n.expression.name.text)&&ts.isExpressionStatement(parent)){ts.forEachChild(n,visit);return;}
     if(ts.isReturnStatement(parent)){let owner=parent.parent;while(owner&&!ts.isFunctionLike(owner))owner=owner.parent;if(owner&&(owner.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)||/^Promise\s*</.test(owner.type?.getText(file)||''))){ts.forEachChild(n,visit);return;}}
     edits.push({start:n.getStart(file),end:n.end,text:`(await ${n.getText(file)})`});return;
    }
   }
   ts.forEachChild(n,visit);
  }
  visit(file);
  if(edits.length){let next=apply(text,edits);for(const helper of [...imports])if(new RegExp('import\\s*\\{[^}]*\\b'+helper+'\\b').test(text))imports.delete(helper);if(imports.size){let rel=path.relative(path.dirname(name),path.join(root,'src','async-collections.js')).replace(/\\/g,'/');if(!rel.startsWith('.'))rel='./'+rel;const line=`import { ${[...imports].join(', ')} } from ${JSON.stringify(rel)};\n`;const at=next.startsWith('#!')?next.indexOf('\n')+1:0;next=next.slice(0,at)+line+next.slice(at);}fs.writeFileSync(name,next);total+=edits.length;}
 }
 console.log(JSON.stringify({async_propagation_pass:pass+1,edits:total,manual_cases:manual.length}));
 if(total===0)break;
}
fs.writeFileSync('/tmp/kolnative-async-manual.json',JSON.stringify(manual,null,2)+'\n');

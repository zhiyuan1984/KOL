const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=process.cwd();const config=ts.readConfigFile(path.join(root,'tsconfig.json'),ts.sys.readFile);const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);let program=ts.createProgram(parsed.fileNames,parsed.options),checker=program.getTypeChecker();
const excluded=new Set(['src/postgres/pool.ts','src/db.ts','tests/postgres-transaction-retry.test.ts','tests/postgres-transaction-context.integration.test.ts']);
const files=program.getSourceFiles().filter(f=>!f.isDeclarationFile&&/^(src|tests|mcp|scripts)\//.test(path.relative(root,f.fileName))&&!excluded.has(path.relative(root,f.fileName))).map(f=>f.fileName);const report=[];
const promised=t=>t?.isUnion?.()?t.types.some(promised):Boolean(t&&checker.getPromisedTypeOfPromise(t));
function strip(n){while(ts.isParenthesizedExpression(n))n=n.expression;return n;}
function awaits(n){if(ts.isAwaitExpression(n))return true;let yes=false;ts.forEachChild(n,c=>{if(!ts.isFunctionLike(c)&&awaits(c))yes=true;});return yes;}
function replace(source,edits){edits.sort((a,b)=>a.start-b.start||b.end-a.end);const accepted=[];let end=-1;for(const e of edits)if(e.start>=end){accepted.push(e);end=e.end;}for(const e of accepted.reverse())source=source.slice(0,e.start)+e.text+source.slice(e.end);return source;}
for(const name of files){const f=program.getSourceFile(name);if(!f)continue;const edits=[],held=new Set();let flat=false;
 function hold(n){if(ts.isIdentifier(n)){const symbol=checker.getSymbolAtLocation(n);if(symbol)held.add(symbol);}}
 function collect(n){if(ts.isCallExpression(n)){const sig=checker.getResolvedSignature(n);if(sig)for(let i=0;i<n.arguments.length;i++){const param=sig.parameters[Math.min(i,sig.parameters.length-1)];if(param&&promised(checker.getTypeOfSymbolAtLocation(param,n)))hold(n.arguments[i]);}}
  if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken&&promised(checker.getTypeAtLocation(n.left)))hold(strip(n.right));
  if(ts.isShorthandPropertyAssignment(n)){const context=checker.getContextualType(n.parent);const prop=context&&checker.getPropertyOfType(checker.getNonNullableType(context),n.name.text);if(prop&&promised(checker.getTypeOfSymbolAtLocation(prop,n))){const symbol=checker.getShorthandAssignmentValueSymbol(n);if(symbol)held.add(symbol);}}
  ts.forEachChild(n,collect);
 }collect(f);
 function visit(n){
  if(ts.isVariableDeclaration(n)&&n.initializer){const v=strip(n.initializer);if(ts.isIdentifier(n.name)&&held.has(checker.getSymbolAtLocation(n.name))&&ts.isAwaitExpression(v)&&promised(checker.getTypeAtLocation(v.expression)))edits.push({start:v.getStart(f),end:v.end,text:v.expression.getText(f)});}
  if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken&&promised(checker.getTypeAtLocation(n.left))){const v=strip(n.right);if(ts.isAwaitExpression(v)&&promised(checker.getTypeAtLocation(v.expression)))edits.push({start:v.getStart(f),end:v.end,text:v.expression.getText(f)});}
  if(ts.isAwaitExpression(n)&&ts.isCallExpression(strip(n.expression))){const call=strip(n.expression);let parent=n.parent;while(ts.isParenthesizedExpression(parent))parent=parent.parent;
   if(ts.isCallExpression(parent)){const index=parent.arguments.findIndex(a=>a.getStart(f)<=n.getStart(f)&&a.end>=n.end);const sig=checker.getResolvedSignature(parent),param=sig?.parameters[Math.min(index,(sig?.parameters.length||1)-1)];if(index>=0&&param&&/pending|promise|connecting|request/i.test(param.name)&&promised(checker.getTypeOfSymbolAtLocation(param,parent))&&promised(checker.getTypeAtLocation(call)))edits.push({start:n.getStart(f),end:n.end,text:n.expression.getText(f)});}
  }
  if(ts.isFunctionLike(n)&&n.body){const prefixes=[];const lastRequired=n.parameters.reduce((last,p,i)=>!p.initializer&&!p.questionToken&&!p.dotDotDotToken?i:last,-1);for(let i=0;i<n.parameters.length;i++){const p=n.parameters[i];if(!p.initializer||!awaits(p.initializer)||!ts.isIdentifier(p.name))continue;const type=p.type?.getText(f)||checker.typeToString(checker.getTypeAtLocation(p.initializer),p,ts.TypeFormatFlags.NoTruncation|ts.TypeFormatFlags.UseFullyQualifiedType);edits.push({start:p.getStart(f),end:p.end,text:p.name.text+(i>lastRequired?'?: '+type:': ('+type+') | undefined')});prefixes.push(`if (${p.name.text} === undefined) ${p.name.text} = ${p.initializer.getText(f)};`);}
   if(prefixes.length){if(ts.isBlock(n.body))edits.push({start:n.body.getStart(f)+1,end:n.body.getStart(f)+1,text:'\n'+prefixes.join('\n')+'\n'});else edits.push({start:n.body.getStart(f),end:n.body.end,text:'{ '+prefixes.join(' ')+' return '+n.body.getText(f)+'; }'});}
  }
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='flatMap'){const callback=n.arguments[0];const sig=callback&&checker.getTypeAtLocation(callback).getCallSignatures()[0];if(sig&&promised(checker.getReturnTypeOfSignature(sig))){edits.push({start:n.getStart(f),end:n.end,text:'(await asyncFlatMap('+n.expression.expression.getText(f)+', '+n.arguments.map(a=>a.getText(f)).join(', ')+'))'});flat=true;return;}}
  ts.forEachChild(n,visit);
 }visit(f);if(edits.length){let source=replace(f.text,edits);if(flat){const rel=path.relative(path.dirname(name),path.join(root,'src/async-collections.js')).replace(/\\/g,'/');source='import { asyncFlatMap } from '+JSON.stringify(rel.startsWith('.')?rel:'./'+rel)+';\n'+source;}fs.writeFileSync(name,source);report.push({file:path.relative(root,name),edits:edits.length});}
}
// Context-sensitive consumption: boolean/short-circuit operands must be resolved;
// promise identity and pending-container ownership must not be resolved away.
program=ts.createProgram(parsed.fileNames,parsed.options);checker=program.getTypeChecker();
for(const name of files){const f=program.getSourceFile(name);if(!f)continue;const edits=[];
 function visit(n){if(ts.isBinaryExpression(n)&&[ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.operatorToken.kind)){const l=strip(n.left),r=strip(n.right);if(ts.isAwaitExpression(l)&&promised(checker.getTypeAtLocation(l.expression))&&promised(checker.getTypeAtLocation(r)))edits.push({start:l.getStart(f),end:l.end,text:l.expression.getText(f)});if(ts.isAwaitExpression(r)&&promised(checker.getTypeAtLocation(r.expression))&&promised(checker.getTypeAtLocation(l)))edits.push({start:r.getStart(f),end:r.end,text:r.expression.getText(f)});}
  if(ts.isCallExpression(n)){const sig=checker.getResolvedSignature(n);if(sig&&promised(checker.getReturnTypeOfSignature(sig))){let parent=n.parent;while(ts.isParenthesizedExpression(parent))parent=parent.parent;const bool=(ts.isBinaryExpression(parent)&&[ts.SyntaxKind.BarBarToken,ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.QuestionQuestionToken].includes(parent.operatorToken.kind))||(ts.isIfStatement(parent)&&parent.expression.getStart(f)<=n.getStart(f)&&parent.expression.end>=n.end)||(ts.isPrefixUnaryExpression(parent)&&parent.operator===ts.SyntaxKind.ExclamationToken)||(ts.isConditionalExpression(parent)&&parent.condition.getStart(f)<=n.getStart(f)&&parent.condition.end>=n.end);
    if(bool){let receiver=parent;let chain=false;while(receiver&&!ts.isFunctionLike(receiver)){if(ts.isPropertyAccessExpression(receiver)&&['then','catch','finally'].includes(receiver.name.text)){chain=true;break;}receiver=receiver.parent;}if(!chain&&!ts.isAwaitExpression(n.parent))edits.push({start:n.getStart(f),end:n.end,text:'(await '+n.getText(f)+')'});}
   }}
  ts.forEachChild(n,visit);
 }visit(f);if(edits.length){fs.writeFileSync(name,replace(f.text,edits));report.push({file:path.relative(root,name),value_consumption_edits:edits.length});}
}
// Mark only real async bodies, never accessors/constructors. Preserve return contracts.
program=ts.createProgram(parsed.fileNames,parsed.options);
for(const name of files){const f=program.getSourceFile(name);if(!f)continue;const edits=[];
 function visit(n){if(ts.isFunctionLike(n)&&n.body&&!ts.isConstructorDeclaration(n)&&!ts.isGetAccessorDeclaration(n)&&!ts.isSetAccessorDeclaration(n)&&awaits(n.body)){
   if(!n.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)){if(ts.isArrowFunction(n)||ts.isFunctionExpression(n))edits.push({start:n.getStart(f),end:n.getStart(f),text:'async '});else{const pos=n.getChildren(f).find(c=>c.kind===ts.SyntaxKind.FunctionKeyword)?.getStart(f)??n.name?.getStart(f);if(pos!==undefined)edits.push({start:pos,end:pos,text:'async '});}}
   if(n.type&&!(ts.isTypeReferenceNode(n.type)&&n.type.typeName.getText(f)==='Promise'))edits.push({start:n.type.getStart(f),end:n.type.end,text:'Promise<Awaited<'+n.type.getText(f)+'>>'});
  }ts.forEachChild(n,visit);
 }visit(f);if(edits.length){fs.writeFileSync(name,replace(f.text,edits));report.push({file:path.relative(root,name),async_body_edits:edits.length});}
}
fs.writeFileSync('/tmp/native-value-repair.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({records:report.length,report:'/tmp/native-value-repair.json'}));

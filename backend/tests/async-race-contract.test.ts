import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe,expect,it } from 'vitest';
function eagerAwait(node:ts.Node):boolean{
 if(ts.isAwaitExpression(node))return true;
 if(ts.isArrowFunction(node)||ts.isFunctionExpression(node)||ts.isFunctionDeclaration(node))return false;
 let found=false;ts.forEachChild(node,n=>{if(eagerAwait(n))found=true;});return found;
}
function violations(text:string,name:string){
 const source=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const found:Array<{file:string;line:number;combinator:string}>=[];
 const walk=(node:ts.Node)=>{
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(source)==='Promise'&&['race','any'].includes(node.expression.name.text)){
   const array=node.arguments[0];if(array&&ts.isArrayLiteralExpression(array))for(const item of array.elements)if(eagerAwait(item))found.push({file:name,line:source.getLineAndCharacterOfPosition(item.getStart(source)).line+1,combinator:node.expression.name.text});
  }ts.forEachChild(node,walk);
 };walk(source);return found;
}
function sourceFiles(root:string):string[]{return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?sourceFiles(path.join(root,e.name)):/\.tsx?$/.test(e.name)?[path.join(root,e.name)]:[]);}
describe('actual async deadline construction',()=>{
 it('detects an upstream awaited before its timeout can enter the race',()=>{
  expect(violations('async function f(){return Promise.race([(await hungUpstream()),timeout]);}','fixture.ts')).toHaveLength(1);
  expect(violations('async function f(){return Promise.any([await delayed(),other]);}','fixture.ts')).toHaveLength(1);
 });
 it('allows promises and asynchronous callback bodies without eager evaluation',()=>{
  expect(violations('async function f(){return Promise.race([hungUpstream(),new Promise(async resolve=>{resolve(await safe())})]);}','fixture.ts')).toEqual([]);
 });
 it('keeps every production race/any connected before awaiting its task',()=>{
  const found=sourceFiles(path.resolve('src')).flatMap(file=>violations(fs.readFileSync(file,'utf8'),path.relative(process.cwd(),file)));
  expect(found).toEqual([]);
 });
});

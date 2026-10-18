import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export const ontologySourceFiles=['config/objects-registry.yaml','config/event-catalog.yaml','config/ontology-semantics.json','config/ontology-enterprise-catalog.json','config/ontology-definition-supplements.json'] as const;
export const readOntologySources=()=>ontologySourceFiles.map(file=>({file,content:fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,'')}));
/** Every semantic input participates in catalog import and confirmation invalidation. */
export const ontologySourceHash=(sources=readOntologySources())=>createHash('sha256').update(JSON.stringify(sources.map(({file,content})=>({file,content:content.replace(/\r\n/g,'\n')})))).digest('hex');

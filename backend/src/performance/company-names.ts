import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/** Labels only. Membership queries remain the sole source of company scope. */
export function performanceCompanyName(id:string):string {
 const file=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../config/org-registry.yaml');
 const registry=parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')) as {companies?:{id:string;display_name:string}[]};
 return registry.companies?.find(company=>company.id===id)?.display_name||id;
}

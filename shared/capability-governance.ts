export type OperationDefinition = {
  id:string;version:number;name:string;description:string;effect:'read'|'draft'|'write';risk:'R1'|'R2'|'R3';asynchronous:boolean;
  inputSchema?:Record<string,unknown>;result?:Record<string,unknown>;
  implementation:{connector:string;tool:string;version:number;jsonArgument?:string;inputFields?:Record<string,string>;topLevelFields?:string[]};
};
export type OperationRow = {id:string;version:number;revision:number;draft:OperationDefinition|null;published:OperationDefinition|null;status:'draft'|'published'|'disabled'|'bundled_baseline';updated_at:string|null;used_by:Array<{id:string;title:string;optional:boolean}>};
export type OperationHistory = {receipt_id:string;revision:number;action:string;definition:OperationDefinition|null;reason:string;actor:string;created_at:string};
export type OperationPreview = {token:string;expiresAt:string;action:string;id:string;version:number;revision:number;previous:OperationDefinition|null;next:OperationDefinition|null;dependency:Record<string,unknown>|null;used_by:OperationRow['used_by'];notice:string};

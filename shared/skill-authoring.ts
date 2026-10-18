/** Business authoring data is a draft/release contract, never an authorization grant. */
export type SkillObjectSelection={object:string;revision:number|null;actions:string[]};
export type SkillAuthoring={version:1;company:string|null;mode:'business'|'general';general_scope:string;purpose:string;use_when:string;expected_result:string;recovery:string;objects:SkillObjectSelection[]};
export type SkillObjectOption={code:string;name:string;description:string;taxonomy:[string,string,string];revision:number|null;status:'registered'|'published';actions:Array<{code:string;name:string;risk?:string}>};
export type SkillCapabilityOption={id:string;version:number;name:string;description:string;risk:string;effect:string;asynchronous:boolean};
export type SkillAuthoringOptions={company:string|null;companies:Array<{id:string;name:string}>;objects:SkillObjectOption[];capabilities:SkillCapabilityOption[];contexts:Array<{key:string;label:string}>};
export type SkillAuthoringState={spec:Record<string,unknown>;stamp:string|null;editable:boolean;draftUpdatedAt?:string|null;imported?:boolean;warnings?:string[]};
export type SkillAuthoringCheck={ready:boolean;issues:string[];reuse:Array<{layer:string;status:'reuse'|'required';detail:string}>};

export type Role = 'orchestrator'|'researcher'|'product_manager'|'engineer'|'qa'|'reviewer';
export type Status = 'idle'|'walking'|'working'|'thinking'|'success'|'error';
export type Vec2 = { x:number; z:number };
export type AgentDefinition = {id:string;name:string;role:Role;species:'rabbit'|'fox'|'cat'|'penguin'|'bear'|'owl';color:string;home:Vec2;work:Vec2};
export const agents:AgentDefinition[] = [
{id:'mochi',name:'Mochi',role:'orchestrator',species:'rabbit',color:'#fff0d6',home:{x:-5,z:-4},work:{x:0,z:0}},
{id:'foxy',name:'Foxy',role:'researcher',species:'fox',color:'#f6a36a',home:{x:-2,z:-5},work:{x:-3,z:0}},
{id:'luna',name:'Luna',role:'product_manager',species:'cat',color:'#f4bad8',home:{x:2,z:-5},work:{x:0,z:-2}},
{id:'pip',name:'Pip',role:'engineer',species:'penguin',color:'#86b8e8',home:{x:5,z:-4},work:{x:3,z:0}},
{id:'bobo',name:'Bobo',role:'qa',species:'bear',color:'#c9a07a',home:{x:-4,z:4},work:{x:-2,z:2}},
{id:'ollie',name:'Ollie',role:'reviewer',species:'owl',color:'#b9a4de',home:{x:4,z:4},work:{x:2,z:2}}
];

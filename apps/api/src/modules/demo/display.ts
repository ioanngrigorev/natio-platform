import { methodAliases } from "./method-aliases.js";

const reverse = new Map(Object.entries(methodAliases).map(([original, alias]) => [alias, original]));
const escape = (s:string) => s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(${Object.keys(methodAliases).sort((a,b)=>b.length-a.length).map(escape).join("|")})(?![\\p{L}\\p{N}_])`,"gu");
const fields = new Set(["name","description","title","message","label","method","methods","payment_method","payment_method_type","account","accountName","account_name","provider_account_name","rule_name"]);

export function demoLabel(value:string) { return methodAliases[value] ?? value.replace(pattern, label => methodAliases[label]); }
export function storedMethod(value:string) { return reverse.get(value) ?? value; }
/** Change display labels only. IDs, credentials, monetary fields and immutable history remain intact. */
export function demoDisplay<T>(value:T, key=""):T {
  if(typeof value === "string") return (fields.has(key) ? demoLabel(value) : value) as T;
  if(Array.isArray(value)) return value.map(v=>demoDisplay(v,key)) as T;
  if(value && typeof value === "object" && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,demoDisplay(v,k)])) as T;
  return value;
}

import {greetingQuotes} from './service.js';
export function dateInZone(date:Date,timeZone:string){return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date)}
export function dailyPerspective(date:string,userId:string){
 let hash=2166136261;for(const c of userId)hash=Math.imul(hash^c.charCodeAt(0),16777619);
 const day=Math.floor(Date.parse(date+'T00:00:00Z')/86400000);
 return greetingQuotes[((day+(hash>>>0))%greetingQuotes.length+greetingQuotes.length)%greetingQuotes.length];
}

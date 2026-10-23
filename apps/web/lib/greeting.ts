export function timeOfDay(hour:number){return hour>=5&&hour<12?'morning':hour>=12&&hour<18?'day':hour>=18&&hour<23?'evening':'night'}
export const greetingLabels={morning:"Good morning",day:"Good afternoon",evening:"Good evening",night:"Good night"};
export function dailyQuoteIndex(day:string,user:string,count:number,offset=0){let hash=2166136261;for(const c of day+user)hash=Math.imul(hash^c.charCodeAt(0),16777619);return count?((hash>>>0)+offset)%count:0;}

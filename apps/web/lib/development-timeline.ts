export const DAY=86400000;
export type Scale='month'|'quarter'|'year'|'all';
export const day=(n:number)=>new Date(n).toISOString().slice(0,10);
export const phaseStyles={
 analysis:{label:'Analysis',color:'#7c3aed'},development:{label:'Development',color:'#2563eb'},
 testing:{label:'Testing',color:'#b45309'},deployment:{label:'Deployment',color:'#047857'},monitoring:{label:'Monitoring',color:'#0e7490'},
};
export function timelineWindow(anchor:string,scale:Scale,first:string,last:string){
 const d=new Date(anchor+'T00:00:00Z'),year=d.getUTCFullYear(),month=d.getUTCMonth();
 if(scale==='all')return {start:Date.parse(first),end:Date.parse(last)+DAY};
 const m=scale==='year'?0:scale==='quarter'?Math.floor(month/3)*3:month;
 return {start:Date.UTC(year,m,1),end:Date.UTC(year,m+(scale==='year'?12:scale==='quarter'?3:1),1)};
}
export function intervalPosition(start:string,end:string,window:{start:number;end:number}){
 const a=Math.max(Date.parse(start),window.start),b=Math.min(Date.parse(end)+DAY,window.end);
 if(b<=a)return null;
 return {left:(a-window.start)/(window.end-window.start)*100,width:(b-a)/(window.end-window.start)*100,clippedStart:Date.parse(start)<window.start,clippedEnd:Date.parse(end)+DAY>window.end};
}
export function timelineTicks(window:{start:number;end:number},scale:Scale){
 const ticks=[window.start];
 if(scale==='month')for(let n=window.start+DAY;n<window.end;n+=DAY){if(new Date(n).getUTCDay()===1)ticks.push(n)}
 else if(scale==='quarter')for(let n=window.start+14*DAY;n<window.end;n+=14*DAY)ticks.push(n);
 else {let d=new Date(window.start);let n=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);while(n<window.end){ticks.push(n);d=new Date(n);n=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)}}
 return [...ticks,window.end];
}

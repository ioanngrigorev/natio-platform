export const DAY=86400000;
export type Scale='month'|'quarter'|'year'|'all';
export const day=(n:number)=>new Date(n).toISOString().slice(0,10);
export const phaseStyles={
 analysis:{label:'Analysis',color:'#a698c5',background:'#eee9f6',ink:'#57446e'},
 development:{label:'Development',color:'#91aec7',background:'#e7eff6',ink:'#365b78'},
 testing:{label:'Testing',color:'#c6b18f',background:'#f3ece1',ink:'#715b39'},
 deployment:{label:'Deployment',color:'#92b4a3',background:'#e6f0ea',ink:'#3e6652'},
 monitoring:{label:'Monitoring',color:'#92b9bd',background:'#e6f1f2',ink:'#3b646b'},
};
export const SUMMARY_HEIGHT=88,PHASE_HEIGHT=66;
export function dependencyPath(x1:number,y1:number,x2:number,y2:number){
 const out=Math.min(998,x1+12),into=Math.max(2,x2-12),lane=y2>y1?y1+38:y1-22;
 return `M ${x1} ${y1} H ${out} V ${lane} H ${into} V ${y2} H ${x2}`;
}
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

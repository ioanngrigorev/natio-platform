import { z } from 'zod';
export const marketSources = [
 {id:'gambling_radar',name:'Gambling Radar',topic:'iGaming',access:'public'},
 {id:'mono_up',name:"monoup · платежки просто",topic:'Payments',access:'public'},
 {id:'gaming_voice',name:'Gaming Voice',topic:'iGaming',access:'private'},
 {id:'product_iG',name:'Product HUB · iGaming',topic:'Product',access:'private'},
] as const;
const cache=new Map<string,{value:any;at:number}>(),pending=new Map<string,Promise<any>>();
async function cached(key:string,ttl:number,fn:()=>Promise<any>){
 const old=cache.get(key);if(old&&Date.now()-old.at<ttl)return {...old.value,stale:false};
 if(pending.has(key))return pending.get(key);
 const task=(async()=>{try{const value=await fn();if(cache.size>100)cache.delete(cache.keys().next().value!);cache.set(key,{value,at:Date.now()});return {...value,stale:false};}catch{if(old)return {...old.value,stale:true,error:'Source temporarily unavailable; last successful snapshot shown'};return {data:[],stale:true,error:'Source temporarily unavailable',fetched_at:null};}finally{pending.delete(key)}})();pending.set(key,task);return task;
}
async function boundedText(url:string){const r=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:'error',headers:{'user-agent':'NATIO-MarketReader/1.0'}});if(!r.ok)throw Error('Upstream unavailable');const reader=r.body?.getReader();if(!reader)throw Error('Empty response');let bytes=0;const chunks:Uint8Array[]=[];try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2500000)throw Error('Response limit');chunks.push(value)}}finally{await reader.cancel().catch(()=>{});}return Buffer.concat(chunks).toString('utf8')}
function plain(html:string){return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,code)=>{const n=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code);return n>0&&n<=0x10ffff?String.fromCodePoint(n):''}).replace(/&(amp|quot|apos|lt|gt|nbsp);/g,(_,n)=>(({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '} as Record<string,string>)[n]||'')).replace(/\s+/g,' ').trim()}
export function parseTelegram(html:string,channel:string){
 const posts=[];for(const part of html.split(/(?=<div[^>]*\bdata-post=)/)){
  const ref=part.match(/data-post="([A-Za-z0-9_]+)\/(\d+)"/),raw=part.match(/class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/)?.[1],date=part.match(/<time[^>]*datetime="([^"]+)"/)?.[1];
  if(!ref||ref[1]!==channel||!raw||!date||!Number.isFinite(Date.parse(date)))continue;
  const text=plain(raw);if(text.length<40)continue;
  const topic=/санкц|aml|отмыв|fraud|мошеннич|чарджбэк|chargeback/i.test(text)?'Risk & AML':/лиценз|регуля|запрет|налог|закон/i.test(text)?'Regulation':'Market';
  posts.push({id:ref[1]+'/'+ref[2],channel,title:text.split(/\s+/).slice(0,20).join(' ')+(text.split(/\s+/).length>20?'…':''),published_at:new Date(date).toISOString(),url:'https://t.me/'+ref[1]+'/'+ref[2],topic});
 }return [...new Map(posts.map(p=>[p.id,p])).values()].slice(-20);
}
export async function newsFeed(){const sources=await Promise.all(marketSources.map(async s=>{if(s.access==='private')return {...s,data:[],status:'access_required',error:'Private channel: authorize a Telegram reader or add an authorized news bot to the channel',fetched_at:null};const r=await cached('news:'+s.id,300000,async()=>{const data=parseTelegram(await boundedText('https://t.me/s/'+s.id),s.id);if(!data.length)throw Error('Public preview unavailable');return {data,fetched_at:new Date().toISOString()}});return {...s,...r,status:r.error?'unavailable':'connected'}}));return {sources:sources.map(({data,...s})=>s),data:sources.flatMap(s=>s.data).sort((a,b)=>b.published_at.localeCompare(a.published_at)),refresh_seconds:60,transport:'public_channel_preview',notice:'Public Telegram posts. Private archived channels are not connected. Headlines are source claims; verify material decisions against primary sources.'}}
const currencies=['EUR','USD','GBP','CHF','BRL','MXN','INR','AED','CNY','JPY','SGD','VND','IDR','THB','PLN','ZAR','TRY'] as const;
export const fxQuery=z.object({base:z.enum(currencies).default('EUR'),quote:z.enum(currencies).default('USD')});
const rate=z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),base:z.string().length(3),quote:z.string().length(3),rate:z.number().positive().finite()});
export async function fxRates(base:string,quote:string){
 const from=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
 const latest=await cached('fx:'+base,1800000,async()=>({data:z.array(rate).parse(JSON.parse(await boundedText('https://api.frankfurter.dev/v2/rates?base='+base+'&quotes='+currencies.filter(c=>c!==base).join(',')))),fetched_at:new Date().toISOString()}));
 const history=base===quote?{data:[],fetched_at:new Date().toISOString(),stale:false}:await cached('fx:'+base+quote+from,1800000,async()=>({data:z.array(rate).parse(JSON.parse(await boundedText(`https://api.frankfurter.dev/v2/rates?base=${base}&quotes=${quote}&from=${from}`))),fetched_at:new Date().toISOString()}));
 return {base,quote,currencies,latest,history,source:'Frankfurter · blended reference rates',source_url:'https://frankfurter.dev/',frequency:'Daily reference rates; not intraday executable quotes',affects_ledger:false};
}

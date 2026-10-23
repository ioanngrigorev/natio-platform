import {isIP} from 'node:net';
import {createHash} from 'node:crypto';

export type SessionLocation={city:string;country:string;time_zone:string};
export function validTimeZone(value:unknown):value is string {
 if(typeof value!=='string'||value.length>80)return false;
 try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return true}catch{return false}
}
export function publicIp(value:string){
 const ip=value.toLowerCase().replace(/^::ffff:/,'');
 if(isIP(ip)===4){const [a,b,c]=ip.split('.').map(Number);if(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113||a===100&&b>=64&&b<=127)return null;return ip}
 if(isIP(ip)===6&&/^[23]/.test(ip)&&!ip.startsWith('2001:db8:')&&!ip.startsWith('2001:0:')&&!ip.startsWith('2002:'))return ip;
 return null;
}
// Only the authenticated request's trusted peer IP is resolved. No arbitrary-IP API.
// Bounded, hashed, memory-only cache; no coordinates/IP returned or persisted.
export class LocationLookup {
 private cache=new Map<string,{until:number;value:SessionLocation|null}>();
 private pending=new Map<string,Promise<SessionLocation|null>>();
 private budgetDay=''; private calls=0; private blockedUntil=0;
 constructor(private fetcher:typeof fetch=fetch,private now=()=>Date.now(),private apiKey=''){}
 async resolve(address:string):Promise<SessionLocation|null>{
  const ip=publicIp(address);if(!ip)return null;
  const key=createHash('sha256').update(ip).digest('hex'),now=this.now(),cached=this.cache.get(key);
  if(cached&&cached.until>now)return cached.value;
  if(this.pending.has(key))return this.pending.get(key)!;
  const day=new Date(now).toISOString().slice(0,10);
  if(day!==this.budgetDay){this.calls=0;this.budgetDay=day}
  if(now<this.blockedUntil||this.calls>=(this.apiKey?950:25))return null;
  this.calls++;
  const lookup=(async()=>{
   let value:SessionLocation|null=null;
   try{
    const r=await this.fetcher('https://api.ipapi.is/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({q:ip,...(this.apiKey?{key:this.apiKey}:{})}),signal:AbortSignal.timeout(1500),redirect:'error'});
    if(r.status===429)this.blockedUntil=Date.parse(day+'T00:00:00Z')+86400000;
    if(r.ok){const b=await r.json() as any,l=b.location??b;
     if(b.ip===ip&&!b.is_bogon&&validTimeZone(l.timezone)&&typeof l.city==='string'&&l.city.length<=100&&typeof l.country==='string'&&l.country.length<=100)value={city:l.city,country:l.country,time_zone:l.timezone};
    }
   }catch{/* Geolocation must never prevent the dashboard from opening. */}
   if(this.cache.size>=500)this.cache.delete(this.cache.keys().next().value!);
   this.cache.set(key,{value,until:this.now()+(value?86400000:600000)});return value;
  })();
  this.pending.set(key,lookup);
  try{return await lookup}finally{this.pending.delete(key)}
 }
}

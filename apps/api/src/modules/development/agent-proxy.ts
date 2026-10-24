import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Readable} from 'node:stream';
/** Short-lived, narrowly scoped capability. The API key never enters a checkout,
 * model shell, test process, container environment or persisted log. */
export async function startAgentProxy(key:string,options:{model?:string;limit?:number;host?:string;port?:number;fetch?:typeof fetch}={}){
 const token=randomBytes(32).toString('hex'),controllers=new Set<AbortController>();let used=0;
 const upstream=options.fetch||fetch;
 const server=createServer(async(req,res)=>{
  const supplied=Buffer.from((req.headers.authorization||'').replace(/^Bearer /,'')),expected=Buffer.from(token);
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){res.writeHead(401).end();return}
  if(req.method!=='POST'||req.url!=='/v1/responses'){res.writeHead(403).end();return}
  if(++used>(options.limit||40)){res.writeHead(429).end();return}
  const controller=new AbortController();controllers.add(controller);
  const timeout=setTimeout(()=>controller.abort(),180_000);
  res.on('close',()=>controller.abort());
  try{
   const chunks:Buffer[]=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>4_000_000){res.writeHead(413).end();return}chunks.push(chunk)}
   const body=JSON.parse(Buffer.concat(chunks).toString());
   if(body.conversation||body.previous_response_id||body.background||(Array.isArray(body.tools)&&body.tools.some((t:any)=>!['function','custom','local_shell'].includes(t.type)))){res.writeHead(403).end();return}
   if(options.model)body.model=options.model;
   body.max_output_tokens=Math.min(Number(body.max_output_tokens)||8192,8192);
   body.store=false;
   const response=await upstream('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
   res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json','cache-control':'no-store'});
   if(response.body)await new Promise<void>((resolve,reject)=>{const stream=Readable.fromWeb(response.body as any);stream.on('error',reject);res.on('finish',resolve);res.on('close',resolve);stream.pipe(res)});else res.end();
  }catch{if(!res.headersSent)res.writeHead(502);res.end()}
  finally{clearTimeout(timeout);controllers.delete(controller)}
 });
 server.requestTimeout=190_000;server.headersTimeout=10_000;
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port||0,options.host||'0.0.0.0',resolve)});
 const port=(server.address() as {port:number}).port;
 return {port,token,close:async()=>{for(const c of controllers)c.abort();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}

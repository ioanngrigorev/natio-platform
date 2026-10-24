import {it,expect} from 'vitest';
import {startAgentProxy} from '../../src/modules/development/agent-proxy.js';
it('keeps the upstream key outside the sandbox and bounds temporary capabilities',async()=>{
 const requests:{url:string;init:RequestInit}[]=[];
 const proxy=await startAgentProxy('private-test-key',{host:'127.0.0.1',model:'fixed-model',limit:1,fetch:(async(url:any,init:any)=>{requests.push({url,init});return new Response('data: done\n\n',{headers:{'content-type':'text/event-stream'}})}) as typeof fetch});
 const url=`http://127.0.0.1:${proxy.port}`,headers={authorization:'Bearer '+proxy.token,'content-type':'application/json'};
 try{
  expect((await fetch(url+'/v1/responses',{method:'POST',body:'{}'})).status).toBe(401);
  expect((await fetch(url+'/v1/files',{method:'POST',headers,body:'{}'})).status).toBe(403);
  const response=await fetch(url+'/v1/responses',{method:'POST',headers,body:JSON.stringify({model:'other-model',max_output_tokens:999999,store:true})});
  expect(await response.text()).toContain('done');expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe('https://api.openai.com/v1/responses');
  expect(requests[0].init.headers).toMatchObject({authorization:'Bearer private-test-key'});
  expect(JSON.parse(String(requests[0].init.body))).toMatchObject({model:'fixed-model',max_output_tokens:8192,store:false});
  expect(proxy.token).not.toContain('private-test-key');
  expect((await fetch(url+'/v1/responses',{method:'POST',headers,body:'{}'})).status).toBe(429);
 }finally{await proxy.close()}
 await expect(fetch(url+'/v1/responses',{method:'POST',headers,body:'{}'})).rejects.toThrow();
});

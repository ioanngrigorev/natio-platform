import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { validateAnswer,askAssistant,transcribeAudio,responseSchema } from '../../src/modules/assistant/client.js';
import { assistantInput } from '../../src/modules/assistant/schemas.js';
import { resetConfigForTests } from '../../src/config.js';
import { buildSignals,riskThresholds } from '../../src/modules/analytics/risk-dashboard.js';
const valid={answer:'График будет рассчитан по данным системы.',sources:['charts','nonexistent'],action:'dashboard',dashboard:{name:'Оборот',from:'2025-01-01',to:'2025-12-31',currency:'EUR',merchant_id:null,country:null,widgets:['volume','outcomes']},connection:null};
beforeEach(()=>{vi.stubEnv('OPENAI_API_KEY','test-not-a-real-secret');resetConfigForTests()});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();resetConfigForTests()});
describe('assistant response boundary',()=>{
 it('accepts bounded actions and filters unknown sources',()=>{const r=validateAnswer(structuredClone(valid));expect(r.dashboard?.filters.currency).toBe('EUR');expect(r.sources).toEqual(['charts'])});
 it('rejects hallucinated actions, bad dates and conflicting action payloads',()=>{for(const r of [{...valid,action:'execute_sql'},{...valid,action:'none'},{...valid,dashboard:{...valid.dashboard,from:'2025-02-31'}}])expect(()=>validateAnswer(structuredClone(r))).toThrow()});
 it('uses strict output and store:false without sending financial records',async()=>{const f=vi.fn().mockResolvedValue(new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify(valid)}]}]}),{status:200}));vi.stubGlobal('fetch',f);const r=await askAssistant({question:'Покажи графики',page:'/admin/bi',history:[],locale:'en'},'test');expect(r.action).toBe('dashboard');const request=JSON.parse(f.mock.calls[0][1].body);expect(request.store).toBe(false);expect(request.text.format.strict).toBe(true);expect(request.input.at(-1).content).toBe('Покажи графики');expect(JSON.stringify(request)).not.toContain('test-not-a-real-secret')});
 it('requires explicit connection geography and mirrors server constraints in structured output',async()=>{
  const proposal={answer:'Проверьте тестовый проект подключения.',sources:['lab'],action:'connection',dashboard:null,connection:{name:'Aurora Demo',adapter:'mock_acquirer',currencies:['EUR'],countries:['DE'],methods:['card'],timeout_ms:10000}};
  expect(validateAnswer(structuredClone(proposal)).connection?.countries).toEqual(['DE']);
  expect(()=>validateAnswer({...proposal,connection:{...proposal.connection,countries:[]}})).toThrow();
  const schema=(responseSchema as any).properties.connection.anyOf[0].properties;
  expect(schema.countries.minItems).toBe(1);expect(schema.timeout_ms.minimum).toBe(1000);expect(schema.timeout_ms.maximum).toBe(30000);
  const clarification={answer:'Для какой страны подготовить подключение?',sources:['lab'],action:'none',dashboard:null,connection:null};
  const f=vi.fn().mockResolvedValue(new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify(clarification)}]}]})));
  vi.stubGlobal('fetch',f);expect((await askAssistant({question:'PSP Aurora Demo для EUR и card',page:'/admin/lab',history:[],locale:'en'},'test')).action).toBe('none');
  expect(JSON.parse(f.mock.calls[0][1].body).instructions).toContain('Never invent a country');
 });
 it('pins merchant dashboard proposals to the authenticated tenant',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify({...valid,dashboard:{...valid.dashboard,merchant_id:'another-tenant'}})}]}]}))));
  const r=await askAssistant({question:'Show my turnover',page:'/dashboard',history:[],locale:'en'},'test',[],'authenticated-merchant');
  expect(r.dashboard?.filters.merchant_id).toBe('authenticated-merchant');
 });
 it('reports invalid credentials without leaking upstream content',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('secret-from-upstream',{status:401})));await expect(askAssistant({question:'Помоги',page:'/admin',history:[],locale:'en'},'test')).rejects.toMatchObject({status:503,code:'assistant_credentials_invalid'});});
 it('distinguishes exhausted credit from temporary rate limits without exposing provider details',async()=>{
  for(const code of ['insufficient_quota','credit_balance_exhausted']){
   vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code,type:'insufficient_quota',message:'private provider details'}}),{status:429})));
   const error=await askAssistant({question:'Помоги',page:'/admin',history:[],locale:'en'},'test').catch(e=>e);
   expect(error.code).toBe('assistant_quota_exhausted');expect(error.message).not.toContain('private provider');
  }
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:'rate_limit_exceeded'}}),{status:429})));
  await expect(askAssistant({question:'Помоги',page:'/admin',history:[],locale:'en'},'test')).rejects.toMatchObject({code:'assistant_capacity'});
 });
 it('does not invent a response when the provider times out or refuses',async()=>{vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Error('timeout')));await expect(askAssistant({question:'Помоги',page:'/admin',history:[],locale:'en'},'test')).rejects.toMatchObject({code:'assistant_timeout'});vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({output:[{content:[{type:'refusal',refusal:'no'}]}]}))));await expect(askAssistant({question:'Помоги',page:'/admin',history:[],locale:'en'},'test')).rejects.toMatchObject({code:'assistant_invalid_response'})});
 it('preserves long dictation through transcription and message validation',async()=>{
  const text='Please improve this payment flow and show its risks. '.repeat(150);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({text}))));
  const transcript=await transcribeAudio(Buffer.alloc(40),'audio/webm;codecs=opus');
  const input=assistantInput.parse({question:transcript.text,page:'/admin',history:[]});
  expect(input.question).toBe(text.trim());
  expect(input.question.length).toBeGreaterThan(4000);
  expect(assistantInput.safeParse({...input,question:'x'.repeat(12001)}).success).toBe(false);
 });
 it('bounds audio and validates transcription output',async()=>{await expect(transcribeAudio(Buffer.alloc(40),'application/pdf')).rejects.toMatchObject({status:422});await expect(transcribeAudio(Buffer.alloc(6*1024*1024),'audio/webm')).rejects.toMatchObject({status:422});vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({text:'Оборот за март'}))));expect(await transcribeAudio(Buffer.alloc(40),'audio/webm')).toEqual({text:'Оборот за март'})});
});
describe('risk signal evidence',()=>{
 it('uses decided count, minimum samples and complete concentration denominator',()=>{const d={currency:'EUR',summary:{volume:10000},merchants:[{id:'m1',name:'One',kyb:'approved',status:'active',successful:85,failed:15,pending:900},{id:'m2',name:'Small',kyb:'approved',status:'active',successful:1,failed:9}],providers:[{id:'p1',name:'PSP',volume:4000}],daily:[]};const r=buildSignals(d,riskThresholds.parse({}));expect(r).toHaveLength(2);expect(r[0].value).toBe(15);expect(r[1].value).toBe(40);expect(r.some(s=>s.entity==='Small')).toBe(false)});
 it('uses preceding days and excludes the current spike from the baseline',()=>{const d={currency:'EUR',summary:{volume:0},merchants:[],providers:[],daily:Array.from({length:8},(_,i)=>({day:'2025-01-'+String(i+1).padStart(2,'0'),payments:i===7?300:100}))};const r=buildSignals(d,riskThresholds.parse({}));expect(r).toHaveLength(1);expect(r[0].value).toBe(3)});
});

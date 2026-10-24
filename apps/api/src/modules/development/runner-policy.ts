import { z } from 'zod';
export const runnerSettings=z.object({
 repository:z.string().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/),
 proxyPort:z.number().int().min(1024).max(65535).default(18765),
 network:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/).default('natio-agents'),
 ref:z.string().regex(/^[\w][\w./-]*$/),
 testRef:z.string().regex(/^[\w][\w./-]*$/).default('codex/agent-test'),
 root:z.string().startsWith('/'),
 image:z.string().regex(/^(?:[\w./:-]+@)?sha256:[a-f0-9]{64}$/),
 model:z.string().min(1).max(100).optional(),
 testDeployHook:z.string().startsWith('/'),
 productionDeployHook:z.string().startsWith('/').optional(),
 timeoutSeconds:z.number().int().min(60).max(7200).default(1800),
 memorySwap:z.string().regex(/^\d+[mg]$/).optional(),
 memory:z.string().regex(/^\d+[mg]$/).default('4g'),
 cpus:z.number().min(0.5).max(8).default(2),
}).strict();
export function assertAllowedFiles(files:string[]){
 if(!files.length)throw new Error('Agent produced no changes');
 if(files.length>100)throw new Error('Change exceeds 100 files');
 for(const f of files){
  if(!/^apps\/(api|web)\/(src|app|components|lib|test)\//.test(f)||/(^|\/)(\.env[^/]*|\.git|AGENTS\.md|SKILL\.md)(\/|$)/i.test(f)||/apps\/api\/src\/(db|config\.ts|modules\/(auth|development)|http\/(guards|routes\/development))/.test(f)||f.includes('..')||f.includes('\n'))throw new Error('Protected file requires manual delivery: '+f);
 }
}
export function deploymentState(target:string){return target==='production'?'awaiting_approval':'deploy_queued'}
export function assertDeployable(r:any){if(!/^[a-f0-9]{40}$/.test(r.commit_sha||'')||!/^[a-f0-9]{40}$/.test(r.base_sha||''))throw new Error('Missing tested commit');if(r.target==='production'&&(!r.approved_by||r.approved_sha!==r.commit_sha))throw new Error('Production approval does not match tested commit')}

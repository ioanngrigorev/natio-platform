// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {TaskOverview} from '../components/development/task-overview';
import {emptyData,type Item} from '../components/development/model';
const api=vi.hoisted(()=>vi.fn());
vi.mock('../components/session-provider',()=>({useSession:()=>({api})}));
it('loads active people for managers while preserving existing assignment and separate description fields',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});api.mockResolvedValue({data:[{id:'a',name:'Anna',email:'anna@example.test'}]});
 const host=document.createElement('div'),root=createRoot(host),data={...emptyData(),assignee:'Existing team',request:'Original request',spec:{...emptyData().spec,objective:'Primary description',acceptance:'Acceptance'}};
 const patch=vi.fn();try{await act(async()=>root.render(<TaskOverview current={null} title="Task" summary="" data={data} editable privateAccess manager base="/admin/development" onTitle={()=>{}} onSummary={()=>{}} onPatch={patch}/>));
 expect(api).toHaveBeenCalledWith('/admin/development/people');expect(host.querySelector('datalist option')?.getAttribute('value')).toBe('anna@example.test');expect((host.querySelector('[aria-label="Assignee"]') as HTMLInputElement).value).toBe('Existing team');expect((host.querySelector('[aria-label="Task description"]') as HTMLTextAreaElement).value).toBe('Primary description');expect(host.textContent).toContain('Original request');
 }finally{act(()=>root.unmount())}
});
it('does not fetch the staff directory for merchant views or expose private requirements in shared view',async()=>{
 api.mockClear();const host=document.createElement('div'),root=createRoot(host);try{await act(async()=>root.render(<TaskOverview current={{status:'backlog'} as Item} title="Shared task" summary="Public text" data={{...emptyData(),request:'Private request',spec:{...emptyData().spec,objective:'Private objective'}}} editable={false} privateAccess={false} manager={false} base="/dashboard/development" onTitle={()=>{}} onSummary={()=>{}} onPatch={()=>{}}/>));expect(api).not.toHaveBeenCalled();expect(host.textContent).not.toContain('Private request');expect(host.querySelector('[aria-label="Task description"]')).toBeNull();expect(host.querySelectorAll('fieldset:disabled')).toHaveLength(2)}finally{act(()=>root.unmount())}
});

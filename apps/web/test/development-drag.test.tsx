// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {DeliveryBoard} from '../components/development/board';
import {emptyData,type Item} from '../components/development/model';

it('accepts a fast native drop before React commits the drag highlight',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const item={id:'fast-drag',title:'Fast drag',status:'backlog',can_edit:true,can_manage:true,is_demo:false,data:emptyData()} as Item;
 const move=vi.fn(async()=>{}),transfer={setData:vi.fn(),effectAllowed:'',dropEffect:''};
 const event=(name:string)=>{const e=new Event(name,{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:transfer});return e};
 try{
  act(()=>root.render(<DeliveryBoard items={[item]} transitions={{backlog:['analysis']}} busy={false} onOpen={()=>{}} onMove={move}/>));
  const card=host.querySelector('article')!,target=host.querySelector('section[aria-label="Analysis"]')!;
  await act(async()=>{
   card.dispatchEvent(event('dragstart'));
   const over=event('dragover');target.dispatchEvent(over);expect(over.defaultPrevented).toBe(true);
   target.dispatchEvent(event('drop'));
  });
  expect(move).toHaveBeenCalledExactlyOnceWith(item,'analysis');
 }finally{act(()=>root.unmount());host.remove()}
});

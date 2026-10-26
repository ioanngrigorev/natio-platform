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

it('drops a card before another card in manual order without changing its status',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const first={id:'first',title:'First',status:'backlog',board_rank:1024,can_manage:true,data:emptyData()} as Item;
 const second={...first,id:'second',title:'Second',board_rank:2048};const rank=vi.fn(async()=>{}),move=vi.fn(async()=>{});
 const event=(name:string)=>{const e=new Event(name,{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:{setData:vi.fn()}});return e};
 try{
  act(()=>root.render(<DeliveryBoard items={[first,second]} transitions={{backlog:['analysis']}} busy={false} onOpen={()=>{}} onMove={move} onRank={rank}/>));
  act(()=>{const select=host.querySelector('select')!;select.value='manual';select.dispatchEvent(new Event('change',{bubbles:true}))});
  await act(async()=>{const cards=host.querySelectorAll('article');cards[1].dispatchEvent(event('dragstart'));cards[0].dispatchEvent(event('dragover'));cards[0].dispatchEvent(event('drop'))});
  expect(rank).toHaveBeenCalledExactlyOnceWith(second,'first');expect(move).not.toHaveBeenCalled();
 }finally{act(()=>root.unmount());host.remove()}
});

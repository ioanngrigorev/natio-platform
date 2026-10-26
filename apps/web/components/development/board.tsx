'use client';
import {useRef,useState} from 'react';
import {useI18n} from '@/lib/i18n/provider';
import {labels,iceScore,type Item} from './model';
export const boardStages=['backlog','todo','in_progress','review','test','done'];
export function boardMoves(item:Item,transitions:Record<string,string[]>){
 if(!item.can_edit&&!item.can_manage)return [];
 return (transitions[item.status]||[]).filter(s=>boardStages.includes(s)&&(item.can_manage||['backlog','todo'].includes(item.status)&&['backlog','todo'].includes(s)));
}
export function DeliveryBoard({items,transitions,busy,onOpen,onMove,wipLimit=5,activeCount=0}:{items:Item[];transitions:Record<string,string[]>;busy:boolean;onOpen:(item:Item)=>void;onMove:(item:Item,status:string)=>Promise<void>;wipLimit?:number;activeCount?:number}){
 const {t}=useI18n(),[dragId,setDragId]=useState<string|null>(null),[over,setOver]=useState<string|null>(null),moving=useRef(false),suppressClick=useRef(false);
 const dragged=items.find(i=>i.id===dragId),allowed=dragged?boardMoves(dragged,transitions):[];
 async function move(item:Item,status:string){
  setDragId(null);setOver(null);
  if(busy||moving.current||!boardMoves(item,transitions).includes(status))return;
  moving.current=true;try{await onMove(item,status)}finally{moving.current=false}
 }
 return <div><p className="mb-3 text-xs text-ink-500">{t('Drag cards to a highlighted column, or use Move to. Status rules still apply.')}</p>
 <div className="grid gap-3 overflow-x-auto" style={{gridTemplateColumns:'repeat(6,minmax(210px,1fr))'}}>
 {boardStages.map(status=><section key={status} aria-label={t(labels[status])} onDragOver={e=>{if(!busy&&allowed.includes(status)){e.preventDefault();e.dataTransfer.dropEffect='move';setOver(status)}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOver(null)}} onDrop={e=>{e.preventDefault();if(dragged)void move(dragged,status)}} className={'min-h-48 rounded-xl border p-3 '+(over===status?'border-brand-600 bg-brand-50 ring-2 ring-brand-600':allowed.includes(status)?'border-brand-600 bg-ink-50':'border-ink-200 bg-ink-50')}>
 <div className="mb-4 flex items-center justify-between"><h3 className="text-xs font-semibold">{t(labels[status])}</h3><span className="rounded-full bg-white px-2 py-1 text-[10px]">{items.filter(i=>i.status===status).length}</span></div>
 {status==='in_progress'&&<p className="mb-3 text-[10px] text-ink-500">{t('Workspace WIP (actual work)')}: {activeCount} / {wipLimit}</p>}
 <div className="space-y-3">{items.filter(i=>i.status===status).map(item=>{const moves=boardMoves(item,transitions),enabled=!busy&&moves.length>0;return <article key={item.id} draggable={enabled} aria-label={item.title} onDragStart={e=>{if(!enabled){e.preventDefault();return}e.dataTransfer.setData('text/plain',item.id);e.dataTransfer.effectAllowed='move';suppressClick.current=true;setDragId(item.id)}} onDragEnd={()=>{setDragId(null);setOver(null);setTimeout(()=>{suppressClick.current=false},0)}} className={'rounded-xl border border-ink-200 bg-white p-3 shadow-sm '+(enabled?'cursor-grab active:cursor-grabbing ':'')+(dragId===item.id?'opacity-50':'')}>
 <span className="text-[9px] uppercase text-ink-500">{t(item.is_demo?'Demonstration':item.data.worker+' delivery')}</span>
 <button type="button" className="my-2 block w-full text-left text-sm font-semibold hover:text-brand-600" onClick={()=>{if(!suppressClick.current)onOpen(item)}}>{item.title}</button>
 <p className="line-clamp-2 text-xs text-ink-500">{item.public_summary}</p>
 <div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-2 text-[10px]"><span>{item.data.assignee||t('Unassigned')}</span><strong className="text-brand-600">ICE {iceScore(item.data)??'—'}</strong></div>
 {!!moves.length&&<select aria-label={t('Move task to')+': '+item.title} className="input mt-3 w-full text-xs" disabled={busy} value="" onChange={e=>void move(item,e.target.value)}><option value="">{t('Move to…')}</option>{moves.map(s=><option key={s} value={s}>{t(labels[s])}</option>)}</select>}
 </article>})}</div></section>)}
 </div></div>;
}

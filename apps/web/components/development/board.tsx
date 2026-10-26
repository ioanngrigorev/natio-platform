'use client';
import {useEffect,useRef,useState} from 'react';
import {useI18n} from '@/lib/i18n/provider';
import {labels,iceScore,issueTypeLabels,type Item} from './model';
export const boardStages=['backlog','analysis','todo','in_progress','test','done'];
export function boardMoves(item:Item,transitions:Record<string,string[]>){
 if(!item.can_edit&&!item.can_manage)return [];
 return (transitions[item.status]||[]).filter(s=>boardStages.includes(s)&&(item.can_manage||['backlog','analysis','todo'].includes(item.status)&&['backlog','analysis','todo'].includes(s)));
}
export function DeliveryBoard({items,transitions,busy,onOpen,onMove,onCreate,onRank,preferenceKey,wipLimit=5,activeCount=0}:{items:Item[];transitions:Record<string,string[]>;busy:boolean;preferenceKey?:string;onRank?:(item:Item,before:string|null)=>Promise<void>;onCreate?:()=>void;onOpen:(item:Item)=>void;onMove:(item:Item,status:string)=>Promise<void>;wipLimit?:number;activeCount?:number}){
 const {t}=useI18n(),[order,setOrder]=useState<'ice'|'manual'>('ice'),[dragId,setDragId]=useState<string|null>(null),[over,setOver]=useState<string|null>(null),moving=useRef(false),draggedRef=useRef<Item|null>(null),suppressClick=useRef(false);
 useEffect(()=>{if(preferenceKey)try{setOrder(localStorage.getItem('natio-board-order:'+preferenceKey)==='manual'?'manual':'ice')}catch{}},[preferenceKey]);
 function chooseOrder(value:'ice'|'manual'){setOrder(value);if(preferenceKey)try{localStorage.setItem('natio-board-order:'+preferenceKey,value)}catch{}}
 // Native drag events can arrive before React commits the visual highlight.
 // Keep the active item synchronously available to dragover and drop.
 const rows=order==='manual'?[...items].sort((a,b)=>(Number(a.board_rank)||0)-(Number(b.board_rank)||0)||a.id.localeCompare(b.id)):items;
 const dragged=items.find(i=>i.id===dragId),allowed=dragged?boardMoves(dragged,transitions):[];
 async function move(item:Item,status:string){
  draggedRef.current=null;setDragId(null);setOver(null);
  if(busy||moving.current||!boardMoves(item,transitions).includes(status))return;
  moving.current=true;try{await onMove(item,status)}finally{moving.current=false}
 }
 async function rank(item:Item,before:string|null){draggedRef.current=null;setDragId(null);setOver(null);if(!onRank||busy||moving.current)return;moving.current=true;try{await onRank(item,before)}finally{moving.current=false}}
 return <div>{onRank&&<label className="mb-3 block text-xs">{t('Card order')}<select className="input ml-2" value={order} onChange={e=>chooseOrder(e.target.value as 'ice'|'manual')}><option value="ice">ICE</option><option value="manual">{t('Manual order')}</option></select></label>}<p className="mb-3 text-xs text-ink-500">{t('Drag cards to a highlighted column, or use Move to. Status rules still apply.')}</p>
 <div className="grid gap-3 overflow-x-auto" style={{gridTemplateColumns:'repeat(6,minmax(210px,1fr))'}}>
 {boardStages.map(status=><section key={status} aria-label={t(labels[status])} onDragOver={e=>{const active=draggedRef.current;if(!busy&&active&&(boardMoves(active,transitions).includes(status)||(order==='manual'&&onRank&&active.status===status))){e.preventDefault();e.dataTransfer.dropEffect='move';setOver(status)}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOver(null)}} onDrop={e=>{e.preventDefault();const active=draggedRef.current;if(active){if(order==='manual'&&onRank&&active.status===status)void rank(active,null);else void move(active,status)}}} className={'min-h-48 rounded-xl border p-3 '+(over===status?'border-brand-600 bg-brand-50 ring-2 ring-brand-600':allowed.includes(status)?'border-brand-600 bg-ink-50':'border-ink-200 bg-ink-50')}>
 <div className="mb-4 flex items-center justify-between"><h3 className="text-xs font-semibold">{t(labels[status])}</h3><span className="rounded-full bg-white px-2 py-1 text-[10px]">{items.filter(i=>(i.status==='review'?'test':i.status)===status).length}</span></div>
 {status==='backlog'&&onCreate&&<button type="button" className="btn-secondary mb-3 w-full" disabled={busy} onClick={onCreate}>{t('Create backlog task')}</button>}
 {status==='in_progress'&&<p className="mb-3 text-[10px] text-ink-500">{t('Workspace WIP (actual work)')}: {activeCount} / {wipLimit}</p>}
 <div className="space-y-3">{rows.filter(i=>(i.status==='review'?'test':i.status)===status).map(item=>{const moves=boardMoves(item,transitions),enabled=!busy&&(moves.length>0||!!onRank&&order==='manual');return <article key={item.id} draggable={enabled} aria-label={item.title} onDragOver={e=>{const active=draggedRef.current;if(order==='manual'&&onRank&&active&&active.id!==item.id&&active.status===item.status){e.preventDefault();e.stopPropagation()}}} onDrop={e=>{const active=draggedRef.current;if(order==='manual'&&onRank&&active&&active.status===item.status){e.preventDefault();e.stopPropagation();void rank(active,item.id)}}} onDragStart={e=>{if(!enabled){e.preventDefault();return}e.dataTransfer.setData('text/plain',item.id);e.dataTransfer.effectAllowed='move';suppressClick.current=true;draggedRef.current=item;setDragId(item.id)}} onDragEnd={()=>{draggedRef.current=null;setDragId(null);setOver(null);setTimeout(()=>{suppressClick.current=false},0)}} className={'rounded-xl border border-ink-200 bg-white p-3 shadow-sm '+(enabled?'cursor-grab active:cursor-grabbing ':'')+(dragId===item.id?'opacity-50':'')}>
 <span className="text-[9px] uppercase text-ink-500">{item.issue_key&&<>{item.issue_key} · {t(issueTypeLabels[item.issue_type||'task'])} · </>}{t(item.is_demo?'Demonstration':item.data.worker+' delivery')}</span>
 <button type="button" className="my-2 block w-full text-left text-sm font-semibold hover:text-brand-600" onClick={()=>{if(!suppressClick.current)onOpen(item)}}>{item.title}</button>
 <p className="line-clamp-2 text-xs text-ink-500">{item.public_summary}</p>
 <div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-2 text-[10px]"><span>{item.data.assignee||t('Unassigned')}</span><strong className="text-brand-600">ICE {iceScore(item.data)??'—'}</strong></div>
 {!!moves.length&&<select aria-label={t('Move task to')+': '+item.title} className="input mt-3 w-full text-xs" disabled={busy} value="" onChange={e=>void move(item,e.target.value)}><option value="">{t('Move to…')}</option>{moves.map(s=><option key={s} value={s}>{t(labels[s])}</option>)}</select>}
 </article>})}</div></section>)}
 </div></div>;
}

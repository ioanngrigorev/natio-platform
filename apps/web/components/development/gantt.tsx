'use client';
import {useEffect,useId,useState} from 'react';
import {useI18n} from '@/lib/i18n/provider';
import {intlLocales} from '@/lib/i18n/core';
import {type Item,labels} from './model';
import {DAY,day,phaseStyles,timelineWindow,timelineTicks,intervalPosition,dependencyPath,SUMMARY_HEIGHT,PHASE_HEIGHT,type Scale} from '@/lib/development-timeline';
export function Gantt({items,onSelect}:{items:Item[];onSelect:(i:Item)=>void}){
 const {t,locale}=useI18n(),marker=useId().replaceAll(':','');
 const rows=items.filter(i=>i.data.plan_start&&i.data.plan_end).map(i=>({...i,data:{...i.data,phases:i.data.phases??[],dependencies:i.data.dependencies??[]}})).sort((a,b)=>a.data.plan_start!.localeCompare(b.data.plan_start!));
 const first=rows[0]?.data.plan_start||day(Date.now()),last=rows.reduce((v,i)=>i.data.plan_end!>v?i.data.plan_end!:v,first);
 const [scale,setScale]=useState<Scale>('quarter'),[anchor,setAnchor]=useState(first),[expanded,setExpanded]=useState<Set<string>>(()=>new Set(rows.slice(0,1).map(i=>i.id))),[links,setLinks]=useState(true);
 useEffect(()=>{if(rows.length&&(anchor<first||anchor>last))setAnchor(first)},[first,last]);
 if(!rows.length)return <p className="py-10 text-center text-ink-500">{t('Schedule start and deadline dates to build a timeline.')}</p>;
 const window=timelineWindow(anchor,scale,first,last),ticks=timelineTicks(window,scale),pct=(n:number)=>(n-window.start)/(window.end-window.start)*100;
 const visible=rows.filter(i=>intervalPosition(i.data.plan_start!,i.data.plan_end!,window));
 const positions=new Map<string,number>();let totalHeight=0;
 for(const i of visible){positions.set(i.id,totalHeight);totalHeight+=SUMMARY_HEIGHT+(expanded.has(i.id)?i.data.phases.length*PHASE_HEIGHT:0)}
 const byId=new Map(items.map(i=>[i.id,i]));
 const edges=visible.flatMap(i=>i.data.dependencies.map(id=>({from:byId.get(id),to:i}))).filter(e=>e.from);
 const date=(value:string)=>new Date(value+'T00:00:00Z').toLocaleDateString(intlLocales[locale],{day:'numeric',month:'short',timeZone:'UTC'});
 const duration=(a:string,b:string)=>Math.round((Date.parse(b)-Date.parse(a))/DAY)+1;
 function move(n:number){const d=new Date(anchor);setAnchor(day(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+n*(scale==='year'?12:scale==='quarter'?3:1),1)))}
 function focus(i:Item){setScale(duration(i.data.plan_start!,i.data.plan_end!)>28?'quarter':'month');setAnchor(i.data.plan_start!);setExpanded(s=>new Set([...s,i.id]))}
 const grid=<>{ticks.slice(0,-1).map(n=><span key={n} className="pointer-events-none absolute inset-y-0 border-l border-ink-100" style={{left:pct(n)+'%'}}/>)}</>;
 function phaseBar(phase:Item['data']['phases'][number]){
  const p=intervalPosition(phase.start,phase.end,window);if(!p)return null;const style=phaseStyles[phase.kind];
  return <><span className="absolute top-3 flex h-7 items-center justify-center rounded border text-[10px] font-medium" style={{left:p.left+'%',width:p.width+'%',background:style.background,color:style.ink,borderColor:style.color}} title={`${phase.name} · ${date(phase.start)} — ${date(phase.end)} · ${phase.progress}%`}>
   {p.width>=5?<span className="whitespace-nowrap px-1">{duration(phase.start,phase.end)}{t(' days')}</span>:null}
   <span className="absolute bottom-0 left-0 h-0.5 rounded" style={{width:phase.progress+'%',background:style.color}}/>
  </span><span className="absolute top-11 whitespace-nowrap text-[10px] text-ink-500" style={{left:Math.min(p.left,85)+'%'}}>{date(phase.start)} — {date(phase.end)}{p.clippedEnd?' →':''}</span></>;
 }
 return <section aria-label={t('Delivery timeline')}>
  <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-lg font-semibold">{date(day(window.start))} — {date(day(window.end-DAY))} <span className="font-normal text-ink-500">{new Date(window.start).getUTCFullYear()}</span></p><p className="mt-1 text-xs text-ink-500">{visible.length}{t(' tasks in view · planned calendar dates · click a task to inspect or edit')}</p></div>
   <div className="flex flex-wrap items-center gap-2"><button className="btn-secondary" aria-label={t('Previous period')} disabled={scale==='all'} onClick={()=>move(-1)}>←</button><label className="sr-only" htmlFor="gantt-month">{t('Timeline month')}</label><input id="gantt-month" className="input !w-40" type="month" value={anchor.slice(0,7)} onChange={e=>{if(e.target.value){setAnchor(e.target.value+'-01');if(scale==='all')setScale('month')}}}/><button className="btn-secondary" aria-label={t('Next period')} disabled={scale==='all'} onClick={()=>move(1)}>→</button><div className="flex gap-1 rounded-xl bg-ink-50 p-1">{(['month','quarter','year','all'] as Scale[]).map(s=><button key={s} className={scale===s?'btn-primary':'btn-secondary'} aria-pressed={scale===s} onClick={()=>setScale(s)}>{t({month:'Month / weeks',quarter:'Quarter',year:'Year',all:'Full plan'}[s])}</button>)}</div></div>
  </div>
  <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">{Object.values(phaseStyles).map(s=><span key={s.label} className="inline-flex items-center gap-2 text-xs"><span className="h-2.5 w-6 rounded-sm border" style={{background:s.background,borderColor:s.color}}/>{t(s.label)}</span>)}<label className="ml-auto inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={links} onChange={e=>setLinks(e.target.checked)}/>{t('Dependencies')}</label><button className="text-xs text-brand-600" onClick={()=>setExpanded(new Set(visible.map(i=>i.id)))}>{t('Expand phases')}</button><button className="text-xs text-brand-600" onClick={()=>setExpanded(new Set())}>{t('Collapse phases')}</button></div>
  <div dir="ltr" className="delivery-gantt overflow-auto rounded-xl border border-ink-200"><div className="min-w-[1080px]">
   <div className="grid grid-cols-[280px_1fr] border-b border-ink-200 bg-ink-50"><div className="p-3 text-xs font-semibold">{t('Feature / lifecycle phase')}</div><div className="relative h-14">{ticks.slice(0,-1).map((n,i)=><div key={n} className="absolute inset-y-0 overflow-hidden border-l border-ink-200 px-2 pt-2 text-[11px] text-ink-500" style={{left:pct(n)+'%',width:(pct(ticks[i+1])-pct(n))+'%'}}><strong className="block whitespace-nowrap text-ink-700">{date(day(n))}</strong><span className="whitespace-nowrap">{scale==='month'?t('Week ')+(i+1):''}</span></div>)}</div></div>
   <div className="relative">
    {visible.map(i=>{const phases=i.data.phases,open=expanded.has(i.id),p=intervalPosition(i.data.plan_start!,i.data.plan_end!,window)!;
     const late=!!i.completed_at&&Date.parse(i.completed_at)>=Date.parse(i.data.plan_end!)+DAY,predecessors=i.data.dependencies.map(id=>byId.get(id)).filter(Boolean) as Item[];
     return <div key={i.id}>
      <div className="grid grid-cols-[280px_1fr] border-b border-ink-100 bg-white" style={{height:SUMMARY_HEIGHT}}>
       <div className="flex min-w-0 items-center gap-2 px-3"><button className="h-7 w-6 shrink-0 rounded hover:bg-ink-100 disabled:opacity-30" disabled={!phases.length} aria-label={(open?t('Collapse '):t('Expand '))+i.title} aria-expanded={open} onClick={()=>setExpanded(s=>{const n=new Set(s);n.has(i.id)?n.delete(i.id):n.add(i.id);return n})}>{open?'⌄':'›'}</button><button className="min-w-0 flex-1 text-left" onClick={()=>onSelect(i)}><strong className="line-clamp-2 text-xs leading-5">{t(i.title)}</strong><span className="block text-[10px] text-ink-500">{i.is_demo?t('DEMO · '):''}{t(labels[i.status]||i.status)} · {i.data.milestone?t('Milestone'):duration(i.data.plan_start!,i.data.plan_end!)+t(' days')}{late?t(' · Late'):''}</span></button><button className="rounded px-1 text-ink-500" aria-label={t('Focus ')+i.title} title={t('Zoom to this task')} onClick={()=>focus(i)}>⊕</button></div>
       <div className="relative min-w-0">{grid}<button className="absolute inset-0 text-left" aria-label={t('Open ')+i.title} onClick={()=>onSelect(i)}>
        {i.data.milestone?<span className="absolute top-6 h-3 w-3 rotate-45 rounded-sm border border-ink-400 bg-ink-200" style={{left:`calc(${p.left}% + ${p.width/2}% - 6px)`}}/>:<span className="absolute top-5 h-4 rounded border border-ink-300 bg-ink-100" style={{left:p.left+'%',width:p.width+'%'}}><span className="absolute inset-y-0 left-0 rounded bg-ink-300/50" style={{width:(i.status==='done'?100:phases.length?phases.reduce((s,a)=>s+a.progress,0)/phases.length:0)+'%'}}/></span>}
        <span className="absolute top-11 whitespace-nowrap text-[10px] text-ink-500" style={{left:Math.min(p.left,75)+'%'}}>{date(i.data.plan_start!)} — {date(i.data.plan_end!)}{p.clippedEnd?' →':''}</span>
       </button>{predecessors.length>0&&<div className="absolute bottom-1 left-2 flex max-w-[95%] gap-2 overflow-hidden text-[9px] text-ink-500">{predecessors.map(pred=><button className="truncate hover:text-brand-600" key={pred.id} title={`${t('Depends on')}: ${pred.title} · ${pred.data.plan_end||''}`} onClick={()=>focus(pred)}>↳ {t(pred.title)}</button>)}</div>}</div>
      </div>
      {open&&phases.map((phase,index)=><div key={phase.id} className="grid grid-cols-[280px_1fr] border-b border-ink-100 bg-white" style={{height:PHASE_HEIGHT}}><div className="flex min-w-0 items-center gap-2 pl-10 pr-3"><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{background:phaseStyles[phase.kind].color}}/><button className="min-w-0 text-left" onClick={()=>onSelect(i)}><span className="block text-xs">{index+1}. {t(phase.name)}</span><span className="text-[10px] text-ink-500">{phase.owner||t('Unassigned')} · {phase.progress}%</span></button></div><button className="relative min-w-0 text-left" aria-label={phase.name+t(' for ')+i.title} onClick={()=>onSelect(i)}>{grid}{phaseBar(phase)}</button></div>)}
     </div>;
    })}
    {links&&totalHeight>0&&<svg className="pointer-events-none absolute inset-y-0 right-0" style={{left:280,width:'calc(100% - 280px)',height:totalHeight}} viewBox={`0 0 1000 ${totalHeight}`} preserveAspectRatio="none" aria-label={t('Finish-to-start dependencies')}>
     <defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L6 3.5 L0 7" fill="none" stroke="currentColor" strokeWidth="1.2"/></marker></defs>
     {edges.map(({from,to})=>{if(!from||!positions.has(from.id))return null;const a=intervalPosition(from.data.plan_start!,from.data.plan_end!,window),b=intervalPosition(to.data.plan_start!,to.data.plan_end!,window);if(!a||!b||a.clippedEnd||b.clippedStart)return null;
      const conflict=from.data.plan_end!>=to.data.plan_start!;
      return <path key={from.id+to.id} data-dependency={`${from.id}:${to.id}`} d={dependencyPath((a.left+a.width)*10,positions.get(from.id)!+28,b.left*10,positions.get(to.id)!+28)} fill="none" stroke="currentColor" strokeWidth="1.15" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeDasharray={from.status==='done'&&!conflict?undefined:'4 4'} markerEnd={`url(#${marker})`} style={{color:conflict?'#a27653':'var(--muted)',opacity:.55}}><title>{from.title} → {to.title} · {t(conflict?'Schedule conflict':'Finish-to-start')}</title></path>;
     })}
    </svg>}
   </div>
   {!visible.length&&<div className="p-8 text-center text-sm text-ink-500">{t('No scheduled tasks in this period. ')}<button className="text-brand-600" onClick={()=>setAnchor(first)}>{t('Go to first task')}</button>{t(' or select Full plan.')}</div>}
  </div></div>
  <p className="mt-3 text-xs text-ink-500">{t('Solid arrows: completed predecessor. Dashed arrows: waiting or schedule conflict. Dates are not moved automatically.')}</p>
 </section>;
}

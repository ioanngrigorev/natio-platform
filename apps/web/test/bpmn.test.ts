import {describe,it,expect} from 'vitest';
import {processModel,bpmnXml,type Bounds,type Point} from '../lib/bpmn-model';
const onBorder=(p:Point,b:Bounds)=>((p[0]===b.x||p[0]===b.x+b.width)&&p[1]>=b.y&&p[1]<=b.y+b.height)||((p[1]===b.y||p[1]===b.y+b.height)&&p[0]>=b.x&&p[0]<=b.x+b.width);
const intersects=(a:Point,b:Point,n:Bounds)=>a[0]===b[0]?a[0]>n.x&&a[0]<n.x+n.width&&Math.max(a[1],b[1])>n.y&&Math.min(a[1],b[1])<n.y+n.height:a[1]>n.y&&a[1]<n.y+n.height&&Math.max(a[0],b[0])>n.x&&Math.min(a[0],b[0])<n.x+n.width;
for(const type of ['payment','delivery'] as const)describe(`${type} BPMN collaboration`,()=>{
 const m=processModel(type),node=(id:string)=>m.nodes.find(n=>n.id===id)!,pool=(id:string)=>m.pools.find(p=>p.id===id);
 it('keeps sequence flows in one participant and messages across participants',()=>{
  for(const f of m.sequences){expect(node(f.source)).toBeTruthy();expect(node(f.target)).toBeTruthy();}
  const participant=(id:string)=>pool(id)?.id||(node(id)?'Natio':undefined);
  for(const f of m.messages){expect(participant(f.source)).toBeTruthy();expect(participant(f.target)).toBeTruthy();expect(participant(f.source)).not.toBe(participant(f.target));}
  for(const n of m.nodes){const l=m.lanes.find(l=>l.id===n.lane)!;expect(l).toBeTruthy();expect(n.y>=l.y&&n.y+n.height<=l.y+l.height).toBe(true);}
 });
 it('has orthogonal connections attached to borders and avoiding unrelated tasks',()=>{
  for(const f of [...m.sequences,...m.messages]){
   expect(onBorder(f.points[0],node(f.source)||pool(f.source)!)).toBe(true);
   expect(onBorder(f.points.at(-1)!,node(f.target)||pool(f.target)!)).toBe(true);
   f.points.slice(1).forEach((p,i)=>{
    const a=f.points[i];expect(a[0]===p[0]||a[1]===p[1]).toBe(true);
    for(const n of m.nodes.filter(n=>n.id!==f.source&&n.id!==f.target))expect(intersects(a,p,n),`${f.id} crosses ${n.id}`).toBe(false);
   });
  }
 });
 it('models starts, ends, default branches and conditional decisions consistently',()=>{
  for(const n of m.nodes){
   const incoming=m.sequences.filter(f=>f.target===n.id),outgoing=m.sequences.filter(f=>f.source===n.id);
   expect(incoming.length>0||n.kind==='startEvent').toBe(true);expect(outgoing.length>0||n.kind==='endEvent').toBe(true);
   if(n.kind==='startEvent'){expect(incoming).toHaveLength(0);expect(n.messageStart).toBe(true);}
   if(n.kind==='endEvent')expect(outgoing).toHaveLength(0);
   if(n.kind==='exclusiveGateway'){
    expect(outgoing).toHaveLength(2);expect(outgoing.find(f=>f.id===n.defaultFlow)?.condition).toBeUndefined();
    expect(outgoing.find(f=>f.id!==n.defaultFlow)?.condition).toBeTruthy();
   }
  }
 });
 it('exports the preview geometry and collaboration, with escaped titles',()=>{
  const xml=bpmnXml('QA & <workflow> "v2"',type);
  expect(xml).toContain('QA &amp; &lt;workflow&gt; &quot;v2&quot;');expect(xml).toContain('bpmnElement="Collaboration_Natio"');
  const ids=[...xml.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);expect(new Set(ids).size).toBe(ids.length);
  for(const f of [...m.sequences,...m.messages]){
   expect(xml).toContain(`sourceRef="${f.source}" targetRef="${f.target}"`);
   expect(xml).toContain(f.points.map(([x,y])=>`<di:waypoint x="${x}" y="${y}"/>`).join(''));
  }
 });
});
it('keeps uncertain payments away from ledger and failed QA on the rework path',()=>{
 const p=processModel('payment'),d=processModel('delivery');
 expect(p.sequences.find(f=>f.target==='Post')?.condition).toContain('psp_status = succeeded and verified = true');
 expect(p.sequences.find(f=>f.id==='Unconfirmed')?.target).toBe('Review');expect(d.sequences.find(f=>f.id==='Rework')?.target).toBe('Build');
});

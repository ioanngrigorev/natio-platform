/** A single BPMN model supplies both the SVG preview and the BPMN 2.0 DI export. */
export type ProcessType = 'delivery' | 'payment';
export type Point = [number, number];
export type Bounds = { x: number; y: number; width: number; height: number };
export type FlowNode = Bounds & {
  id: string; name: string; lines: string[]; lane: string;
  kind: 'startEvent' | 'endEvent' | 'serviceTask' | 'userTask' | 'sendTask' | 'receiveTask' | 'exclusiveGateway';
  messageStart?: boolean; label?: Bounds; defaultFlow?: string;
};
export type Pool = Bounds & { id: string; name: string; expanded?: boolean };
export type Lane = Bounds & { id: string; name: string };
export type Flow = { id: string; source: string; target: string; points: Point[]; name?: string; label?: Bounds; condition?: string };
export type BpmnModel = { width: number; height: number; pools: Pool[]; lanes: Lane[]; nodes: FlowNode[]; sequences: Flow[]; messages: Flow[] };
const bounds = (x: number, y: number, width: number, height: number): Bounds => ({x,y,width,height});
const task = (id: string, lines: string[], lane: string, kind: FlowNode['kind'], x: number, y: number, width=140, height=64): FlowNode => ({id,name:lines.join(' '),lines,lane,kind,...bounds(x,y,width,height)});
const event = (id: string, name: string, lane: string, x: number, y: number, end=false): FlowNode => ({id,name,lines:[name],lane,kind:end?'endEvent':'startEvent',messageStart:!end,...bounds(x-18,y-18,36,36),label:bounds(x-65,y+25,130,24)});
const gateway = (id: string, name: string, lane: string, x: number, y: number, defaultFlow: string, labelBox?: Bounds): FlowNode => ({id,name,lines:[name],lane,kind:'exclusiveGateway',defaultFlow,...bounds(x-25,y-25,50,50),label:labelBox||bounds(x-80,y-59,160,26)});
const flow = (id: string, source: string, target: string, points: Point[], name?: string, label?: Bounds, condition?: string): Flow => ({id,source,target,points,name,label,condition});

export function processModel(type: ProcessType): BpmnModel {
  if (type === 'payment') return {
    width:1280,height:710,
    pools:[
      {id:'Customer',name:'Customer',...bounds(24,24,260,56)},
      {id:'Merchant',name:'Merchant',...bounds(380,24,260,56)},
      {id:'PSP',name:'PSP',...bounds(916,24,340,56)},
      {id:'Natio',name:'NATIO',expanded:true,...bounds(24,200,1232,480)},
    ],
    lanes:[{id:'Orchestration',name:'Orchestration',...bounds(58,200,1198,210)},{id:'Finance',name:'Finance / reconciliation',...bounds(58,410,1198,270)}],
    nodes:[
      event('Received','Payment received','Orchestration',180,330),
      task('Validate',['Authenticate','& validate'],'Orchestration','serviceTask',235,298),
      gateway('Valid','Valid request?','Orchestration',435,330,'Invalid',bounds(355,365,160,26)),
      task('Reject',['Reject request'],'Orchestration','sendTask',500,214,140,54),
      event('Rejected','Rejected','Orchestration',700,241,true),
      task('Route',['Select eligible','PSP route'],'Orchestration','serviceTask',500,298),
      task('Submit',['Submit payment'],'Orchestration','sendTask',700,298),
      task('Receive',['Receive PSP','result'],'Orchestration','receiveTask',930,298),
      gateway('Success','Success verified?','Finance',1000,470,'Unconfirmed',bounds(1025,416,180,26)),
      task('Post',['Record ledger','movement'],'Finance','serviceTask',700,438),
      task('Notify',['Publish status','webhook'],'Finance','sendTask',500,438),
      event('Completed','Completed','Finance',430,470,true),
      task('Review',['Review /','reconcile'],'Finance','userTask',700,548),
      event('Unsettled','Not settled','Finance',630,580,true),
    ],
    sequences:[
      flow('StartValidation','Received','Validate',[[198,330],[235,330]]),
      flow('CheckValidation','Validate','Valid',[[375,330],[410,330]]),
      flow('Invalid','Valid','Reject',[[435,305],[435,241],[500,241]],'No',bounds(447,244,35,24)),
      flow('RejectEnd','Reject','Rejected',[[640,241],[682,241]]),
      flow('Eligible','Valid','Route',[[460,330],[500,330]],'Yes',bounds(462,337,36,24),'request_valid = true'),
      flow('SubmitRoute','Route','Submit',[[640,330],[700,330]]),
      flow('AwaitResult','Submit','Receive',[[840,330],[930,330]]),
      flow('VerifyResult','Receive','Success',[[1000,362],[1000,445]]),
      flow('Confirmed','Success','Post',[[975,470],[840,470]],'Yes',bounds(887,442,40,24),'psp_status = succeeded and verified = true'),
      flow('LedgerNotification','Post','Notify',[[700,470],[640,470]]),
      flow('Complete','Notify','Completed',[[500,470],[448,470]]),
      flow('Unconfirmed','Success','Review',[[1000,495],[1000,580],[840,580]],'No / unknown',bounds(1020,533,130,24)),
      flow('ReviewEnd','Review','Unsettled',[[700,580],[648,580]]),
    ],
    messages:[
      flow('PaymentIntent','Customer','Merchant',[[284,52],[380,52]],'Payment intent',bounds(268,83,145,24)),
      flow('CreatePayment','Merchant','Received',[[450,80],[450,160],[180,160],[180,312]],'Create payment',bounds(212,130,170,24)),
      flow('StatusWebhook','Natio','Merchant',[[610,200],[610,80]],'Status / rejection',bounds(624,88,180,24)),
      flow('PspRequest','Submit','PSP',[[770,298],[770,120],[1030,120],[1030,80]],'Payment request',bounds(810,90,165,24)),
      flow('PspResponse','PSP','Receive',[[1150,80],[1150,160],[1000,160],[1000,298]],'PSP result',bounds(1030,166,120,24)),
    ],
  };
  return {
    width:1280,height:870,
    pools:[{id:'Requester',name:'Requester / merchant',...bounds(24,24,1232,56)},{id:'Natio',name:'NATIO delivery',expanded:true,...bounds(24,200,1232,640)}],
    lanes:[
      {id:'Product',name:'Product / analyst',...bounds(58,200,1198,190)},
      {id:'Engineering',name:'Engineering',...bounds(58,390,1198,150)},
      {id:'Quality',name:'QA',...bounds(58,540,1198,150)},
      {id:'Operations',name:'Operations',...bounds(58,690,1198,150)},
    ],
    nodes:[
      event('Received','Request received','Product',175,315),
      task('ReviewSpec',['Review spec','& BPMN'],'Product','userTask',235,283,150),
      gateway('Approved','Approved?','Product',450,315,'Revise',bounds(370,352,160,26)),
      task('RequestChanges',['Request changes'],'Product','sendTask',515,212,150,54),
      event('Revision','Await revision','Product',735,239,true),
      task('Backlog',['Prioritise','in backlog'],'Product','userTask',515,283,150),
      task('Build',['Build &','code review'],'Engineering','userTask',735,433,150),
      task('Test',['Regression &','acceptance'],'Quality','userTask',735,583,150),
      gateway('Passed','Tests passed?','Quality',950,615,'Rework',bounds(775,546,160,26)),
      task('Deploy',['Deploy & verify'],'Operations','userTask',1020,733,150),
      event('Released','Released','Operations',1210,765,true),
    ],
    sequences:[
      flow('ReviewRequest','Received','ReviewSpec',[[193,315],[235,315]]),
      flow('Decision','ReviewSpec','Approved',[[385,315],[425,315]]),
      flow('Revise','Approved','RequestChanges',[[450,290],[450,239],[515,239]],'No',bounds(463,242,35,24)),
      flow('RevisionEnd','RequestChanges','Revision',[[665,239],[717,239]]),
      flow('Prioritise','Approved','Backlog',[[475,315],[515,315]],'Yes',bounds(476,323,36,24),'request_approved = true'),
      flow('StartBuild','Backlog','Build',[[665,315],[810,315],[810,433]]),
      flow('RunTests','Build','Test',[[810,497],[810,583]]),
      flow('CheckTests','Test','Passed',[[885,615],[925,615]]),
      flow('Rework','Passed','Build',[[950,590],[950,465],[885,465]],'Fail',bounds(967,507,55,24)),
      flow('Ship','Passed','Deploy',[[975,615],[1095,615],[1095,733]],'Pass',bounds(1030,584,55,24),'acceptance_passed = true'),
      flow('ReleaseEnd','Deploy','Released',[[1170,765],[1192,765]]),
    ],
    messages:[
      flow('Requirements','Requester','Received',[[175,80],[175,297]],'Requirements',bounds(190,126,170,24)),
      flow('Feedback','RequestChanges','Requester',[[590,212],[590,80]],'Revision requested',bounds(605,126,190,24)),
      flow('ReleaseNotice','Natio','Requester',[[1120,200],[1120,80]],'Release update',bounds(946,126,160,24)),
    ],
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const rect = (b: Bounds) => `<dc:Bounds x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}"/>`;
const label = (b?: Bounds) => b ? `<bpmndi:BPMNLabel>${rect(b)}</bpmndi:BPMNLabel>` : '';
export function bpmnXml(title: string, type: ProcessType): string {
  const m=processModel(type);
  const documentation='Non-executable BPMN collaboration template. Review conditions and integration details before implementation. A verified successful PSP result is required before posting a payment movement. Dates and team in demo records are fictional.';
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Definitions_Natio" targetNamespace="https://natio.me/development">
<bpmn:collaboration id="Collaboration_Natio" name="${esc(title)}">${m.pools.map(p=>`<bpmn:participant id="${p.id}" name="${esc(p.name)}"${p.expanded?' processRef="Process_Natio"':''}/>`).join('')}${m.messages.map(f=>`<bpmn:messageFlow id="${f.id}" name="${esc(f.name||'')}" sourceRef="${f.source}" targetRef="${f.target}"/>`).join('')}</bpmn:collaboration>
<bpmn:process id="Process_Natio" name="${esc(title)}" isExecutable="false"><bpmn:documentation>${documentation}</bpmn:documentation><bpmn:laneSet id="LaneSet_Natio">${m.lanes.map(l=>`<bpmn:lane id="${l.id}" name="${esc(l.name)}">${m.nodes.filter(n=>n.lane===l.id).map(n=>`<bpmn:flowNodeRef>${n.id}</bpmn:flowNodeRef>`).join('')}</bpmn:lane>`).join('')}</bpmn:laneSet>${m.nodes.map(n=>`<bpmn:${n.kind} id="${n.id}" name="${esc(n.name)}"${n.defaultFlow?` default="${n.defaultFlow}" gatewayDirection="Diverging"`:''}>${m.sequences.filter(f=>f.target===n.id).map(f=>`<bpmn:incoming>${f.id}</bpmn:incoming>`).join('')}${m.sequences.filter(f=>f.source===n.id).map(f=>`<bpmn:outgoing>${f.id}</bpmn:outgoing>`).join('')}${n.messageStart?`<bpmn:messageEventDefinition id="${n.id}_Message"/>`:''}</bpmn:${n.kind}>`).join('')}${m.sequences.map(f=>`<bpmn:sequenceFlow id="${f.id}"${f.name?` name="${esc(f.name)}"`:''} sourceRef="${f.source}" targetRef="${f.target}">${f.condition?`<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${esc(f.condition)}</bpmn:conditionExpression>`:''}</bpmn:sequenceFlow>`).join('')}</bpmn:process>
<bpmndi:BPMNDiagram id="Diagram_Natio"><bpmndi:BPMNPlane id="Plane_Natio" bpmnElement="Collaboration_Natio">${m.pools.map(p=>`<bpmndi:BPMNShape id="Shape_${p.id}" bpmnElement="${p.id}" isHorizontal="true">${rect(p)}</bpmndi:BPMNShape>`).join('')}${m.lanes.map(l=>`<bpmndi:BPMNShape id="Shape_${l.id}" bpmnElement="${l.id}" isHorizontal="true">${rect(l)}</bpmndi:BPMNShape>`).join('')}${m.nodes.map(n=>`<bpmndi:BPMNShape id="Shape_${n.id}" bpmnElement="${n.id}"${n.kind==='exclusiveGateway'?' isMarkerVisible="true"':''}>${rect(n)}${label(n.label)}</bpmndi:BPMNShape>`).join('')}${[...m.sequences,...m.messages].map(f=>`<bpmndi:BPMNEdge id="Edge_${f.id}" bpmnElement="${f.id}">${f.points.map(([x,y])=>`<di:waypoint x="${x}" y="${y}"/>`).join('')}${label(f.label)}</bpmndi:BPMNEdge>`).join('')}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
}

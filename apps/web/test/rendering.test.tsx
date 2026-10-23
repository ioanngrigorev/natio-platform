import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {Gantt} from '../components/development/gantt';
import {emptyData, type Item} from '../components/development/model';
import {LocaleProvider} from '../lib/i18n/provider';
import {AdminThemeProvider, SidebarThemeToggle} from '../components/admin/theme-provider';
import {EngineeringEstimate} from '../components/development/estimate';
import {ServiceError} from '../components/service-error';

function item(overrides: Partial<Item> = {}): Item {
  return {id:'fixture',title:'Synthetic delivery',public_summary:'Test fixture',status:'done',visibility:'public',data:{...emptyData(),plan_start:'2025-01-01',plan_end:'2025-02-05'},priority_score:0,version:1,is_demo:true,started_at:null,completed_at:null,created_at:'2025-01-01',updated_at:'2025-01-01',sprint_id:null,can_edit:false,can_manage:false,private_access:false,...overrides};
}
const render = (items: Item[]) => renderToStaticMarkup(<LocaleProvider locale="en" dictionary={{}}><Gantt items={items} onSelect={()=>undefined}/></LocaleProvider>);
describe('delivery view contract',()=>{
  it('renders legacy API items without phases/dependencies instead of crashing SSR',()=>{
    const legacy=item(); delete (legacy.data as Partial<Item['data']>).phases; delete (legacy.data as Partial<Item['data']>).dependencies;
    const html=render([legacy]); expect(html).toContain('Synthetic delivery'); expect(html).toContain('36 days');
    expect(html).not.toContain('gantt-dependency');
  });
  it('renders an empty schedule with a useful next step',()=>{expect(render([])).toContain('Schedule start and deadline dates');});
  it('keeps dependencies as task references without drawing the removed arrow overlay',()=>{
    const first=item({id:'first',title:'Synthetic prerequisite'}),second=item({id:'second',data:{...item().data,dependencies:['first']}});
    const html=render([first,second]);expect(html).toContain('Depends on');expect(html).toContain('Synthetic prerequisite');expect(html).not.toContain('<path');
  });
  it('shows readable phase durations and completion without fabricating dates',()=>{
    const task=item();task.data.phases=[{id:'phase',kind:'analysis',name:'Analysis',start:'2025-01-01',end:'2025-01-10',owner:'Synthetic analyst',progress:80}];
    const html=render([task]);expect(html).toContain('10 days');expect(html).toContain('80%');expect(html).toContain('Synthetic analyst');
  });
});
describe('failure view',()=>{
  it('provides recovery and a correlation reference without leaking an exception',()=>{
    const error=Object.assign(new Error('postgres://private-credentials@server'),{digest:'diagnostic-reference'});
    const html=renderToStaticMarkup(<ServiceError error={error} reset={()=>undefined}/>);
    expect(html).toContain('Try again');expect(html).toContain('diagnostic-reference');expect(html).not.toContain('private-credentials');
  });
});

describe('navigation tone and delivery estimates',()=>{
  it.each(['light','dark','mint'] as const)('exposes both menu tones in the %s workspace',theme=>{
    for(const sidebar of ['light','dark'] as const){
      const html=renderToStaticMarkup(<LocaleProvider locale="en" dictionary={{}}><AdminThemeProvider initialTheme={theme} initialSidebar={sidebar}><SidebarThemeToggle/></AdminThemeProvider></LocaleProvider>);
      expect(html).toContain('Sidebar appearance');expect(html).toContain('Light menu');expect(html).toContain('Dark menu');expect(html).toContain(`data-sidebar="${sidebar}"`);
    }
  });
  it('keeps a three-day deployment duration visible at quarter scale',()=>{
    const task=item();task.data.phases=[{id:'short',kind:'deployment',name:'Deployment',start:'2025-02-03',end:'2025-02-05',owner:'Demo',progress:100}];
    const html=render([task]);expect(html).toContain('data-phase-duration');expect(html).toContain('3 days');expect(html).toContain('calc(100% + 6px)');
  });
  it('shows the agreed hourly rate and a cost that follows effort',()=>{
    const renderCost=(hours:number)=>renderToStaticMarkup(<LocaleProvider locale="en" dictionary={{}}><EngineeringEstimate hours={hours}/></LocaleProvider>);
    expect(renderCost(40)).toContain('$1,200');expect(renderCost(40)).toContain('$30');expect(renderCost(8)).toContain('$240');expect(renderCost(40)).not.toContain('Risk-adjusted');
  });
});

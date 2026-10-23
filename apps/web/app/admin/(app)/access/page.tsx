import {getAdminSession} from '@/lib/session';
import {adminCan} from '@/lib/admin-permissions';
import {getI18n} from '@/lib/i18n/server';

export default async function AccessPage(){
 const session=await getAdminSession();
 const {t}=await getI18n();
 const role=session!.admin.role;
 const roleLabel:Record<string,string>={superadmin:'Superadmin',administrator:'Administrator',technical:'Technical manager',finance:'Financial manager',readonly:'Read-only observer'};
 const areas=[
  ['Dashboard & reports','admin.read'],['Financial reports','finance.read'],['Provider setup & routing','integrations.read'],
  ['Platform diagnostics','platform.read'],['Merchant administration','merchants.manage'],['Payment operations','operations.retry'],
  ['Keys & integrations','integrations.manage'],['Pricing & margin','pricing.manage'],['Reconciliation','reconciliation.manage'],
  ['Settlement management','settlements.manage'],['Development delivery','development.manage'],['Access administration','admin_users.manage'],
 ] as const;
 return <section className="space-y-6"><div><p className="text-xs uppercase tracking-widest text-ink-500">{t('My access')}</p><h1 className="mt-2 text-2xl font-semibold">{t(roleLabel[role]||role)}</h1><p className="mt-2 text-sm text-ink-500">{t('Your role determines available sections and actions. Permissions are enforced on the server.')}</p></div>
 <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{areas.map(([label,permission])=><div key={permission} className="rounded-xl border border-ink-200 bg-white p-5"><p className="text-sm font-medium">{t(label)}</p><p className={'mt-3 text-xs '+(adminCan(role,permission)?'text-ok':'text-ink-500')}>{t(adminCan(role,permission)?'Available':'Restricted')}</p></div>)}</div>
 <p className="text-sm text-ink-500">{t('Contact a superadmin to change access. Merchant accounts are restricted to their own organization.')}</p></section>;
}

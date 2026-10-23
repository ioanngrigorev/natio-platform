import type {ReactNode} from 'react';
const shapes:Record<string,ReactNode>={
 ledger:<><path d="M5 3h14v18H5zM9 7h6M9 11h2m3 0h1m-6 4h2m3 0h1"/></>,
 payments:<><rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M3 10h18m-14 5h4"/></>,
 routing:<><circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 12h3a3 3 0 0 0 3-3V8a3 3 0 0 1 3-3h1m-7 7a3 3 0 0 1 3 3v1a3 3 0 0 0 3 3h1"/></>,
 pricing:<><path d="m3 4 8-1 10 10-8 8L3 11V4Z"/><circle cx="7" cy="7" r="1"/><path d="m10 10 5 5m-5 0 5-5"/></>,
 reports:<><path d="M4 3v18h17M8 16v-4m5 4V7m5 9V4"/></>,
 receipts:<><path d="M5 3h10l4 4v14H5V3Zm10 0v5h4M9 12h6m-6 4 2 2 4-4"/></>,
 risk:<><path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z"/><path d="M12 7v6m0 4h.01"/></>,
 lab:<><path d="M9 3h6m-5 0v6L4 19a1.5 1.5 0 0 0 1 2h14a1.5 1.5 0 0 0 1-2L14 9V3M8 14h8"/><circle cx="12" cy="17" r=".6"/></>,
 support:<><path d="M4 13V11a8 8 0 0 1 16 0v2M4 12H2v6h4v-6H4Zm16 0h2v6h-4v-6h2Zm0 6v2h-6"/><circle cx="12" cy="20" r="1"/></>,
 api:<><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/></>
};
export function ModuleIcon({id}:{id:string}){return <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-ink-50 text-brand-600" aria-hidden="true"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">{shapes[id]||shapes.api}</svg></span>}

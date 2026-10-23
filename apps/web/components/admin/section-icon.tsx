"use client";
import {useI18n} from '@/lib/i18n/provider';

import type { ReactNode } from 'react';
const shapes:Record<string,ReactNode>={
 Operations:<><path d="M4 7h14m-4-4 4 4-4 4M20 17H6m4-4-4 4 4 4"/></>,
 Customers:<><circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/></>,
 Finance:<><path d="m3 9 9-6 9 6H3Zm2 3v6m5-6v6m4-6v6m5-6v6M3 21h18"/></>,
 'Payment setup':<><path d="M4 5h16M4 12h16M4 19h16"/><circle cx="8" cy="5" r="2" fill="var(--surface)"/><circle cx="16" cy="12" r="2" fill="var(--surface)"/><circle cx="9" cy="19" r="2" fill="var(--surface)"/></>,
 Development:<><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></>,
 Platform:<><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></>,
 Support:<><path d="M12 6c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v15"/></>,
};
export function SectionIcon({name}:{name:string}){
 const {t:translateUi,locale:uiLocale}=useI18n();
return <span className="nav-section-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{translateUi(shapes[name]||<path d="M4 18V9m8 9V4m8 14v-6"/>)}</svg></span>}

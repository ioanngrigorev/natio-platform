'use client';
import {createContext,useContext,useMemo,type ReactNode} from 'react';
import {translator,languageNames,locales,type Dictionary,type Locale} from './core';
const Context=createContext({locale:'en' as Locale,t:translator({})});
export function LocaleProvider({locale,dictionary,children}:{locale:Locale;dictionary:Dictionary;children:ReactNode}){
 const value=useMemo(()=>({locale,t:translator(dictionary)}),[locale,dictionary]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useI18n=()=>useContext(Context);
export function LanguagePicker({compact=false}:{compact?:boolean}){const {locale,t}=useI18n();return <label className={'language-picker '+(compact?'compact':'')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z"/></svg><span className="sr-only">{t('Language')}</span><select aria-label={t('Language')} value={locale} onChange={e=>{document.cookie='natio_locale='+e.target.value+'; path=/; max-age=31536000; samesite=lax'+(location.protocol==='https:'?'; secure':'');window.location.reload();}}>{locales.map(l=><option key={l} value={l} lang={l}>{languageNames[l]}</option>)}</select></label>}

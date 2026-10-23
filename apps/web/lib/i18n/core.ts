export const locales = ['en','ru','es','ar','pt'] as const;
export type Locale = typeof locales[number];
export type Dictionary = Record<string,string>;
export const languageNames:Record<Locale,string>={en:'English',ru:'Русский',es:'Español',ar:'العربية',pt:'Português'};
export const intlLocales:Record<Locale,string>={en:'en-GB',ru:'ru-RU',es:'es-ES',ar:'ar',pt:'pt-BR'};
export const validLocale=(value:unknown):Locale=>locales.includes(value as Locale)?value as Locale:'en';
export function translator(dictionary:Dictionary){return function translate<T>(value:T):T {
 if(typeof value!=='string'||!value.trim())return value;
 const normalized=value.replace(/\s+/g,' ').trim();
 const result=Object.prototype.hasOwnProperty.call(dictionary,normalized)?dictionary[normalized]:undefined;
 if(result===undefined)return value;
 return (value.match(/^\s*/)?.[0]+result+value.match(/\s*$/)?.[0]) as T;
}}

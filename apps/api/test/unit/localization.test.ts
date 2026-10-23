import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {translator,validLocale} from '../../../web/lib/i18n/core.js';
import {localizedKnowledge,searchKnowledge} from '../../src/modules/assistant/knowledge.js';
const catalog=(language:string)=>JSON.parse(readFileSync(new URL('../../../web/lib/i18n/catalogs/'+language+'.json',import.meta.url),'utf8'));
describe('five-language interface',()=>{
 it('defaults to English and refuses unrecognised locales',()=>{for(const v of [undefined,'auto','../../etc/passwd','<script>','fr'])expect(validLocale(v)).toBe('en');expect(validLocale('ar')).toBe('ar')});
 it('translates authored copy while preserving money, API identifiers, references and React values',()=>{const t=translator(catalog('es'));expect(t('Overview')).not.toBe('Overview');expect(t('  Overview ')).toMatch(/^  .+ $/);for(const v of ['EUR','pay_123456','FTD',1234,null,undefined])expect(t(v)).toBe(v);const obj={value:'Overview'};expect(t(obj)).toBe(obj);});
 it('has aligned non-empty catalogs and no Cyrillic in English fallback copy',()=>{const keys=Object.keys(catalog('ru')).sort();expect(keys.length).toBeGreaterThan(5000);for(const l of ['es','ar','pt'])expect(Object.keys(catalog(l)).sort()).toEqual(keys);for(const l of ['en','ru','es','ar','pt'])expect(Object.values(catalog(l)).every(v=>typeof v==='string'&&v.length>0)).toBe(true);expect(Object.values(catalog('en')).some(v=>/[А-Яа-яЁё]/.test(String(v)))).toBe(false)});
 it('serves the knowledge base in the requested language with stable links and IDs',()=>{const en=localizedKnowledge('en');expect(en).toHaveLength(16);for(const a of en){expect(/[А-Яа-яЁё]/.test(JSON.stringify([a.title,a.summary,a.category,a.steps,a.sections]))).toBe(false)}for(const l of ['ru','es','ar','pt'] as const){const rows=localizedKnowledge(l);expect(rows.map(a=>[a.id,a.route])).toEqual(en.map(a=>[a.id,a.route]));expect(rows[0].title).not.toBe(en[0].title);expect(searchKnowledge(rows[0].title,rows[0].category,l).some(a=>a.id===rows[0].id)).toBe(true)}});
});

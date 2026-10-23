import 'server-only';
import {cookies} from 'next/headers';
import {validLocale,translator,type Dictionary,type Locale} from './core';
import en from './catalogs/en.json';
import ru from './catalogs/ru.json';
import es from './catalogs/es.json';
import ar from './catalogs/ar.json';
import pt from './catalogs/pt.json';
const dictionaries:Record<Locale,Dictionary>={en,ru,es,ar,pt};
export function getI18n(){const locale=validLocale(cookies().get('natio_locale')?.value);return {locale,t:translator(dictionaries[locale]),dictionary:dictionaries[locale]};}

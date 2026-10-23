"""Rebuild the historical library from the cited public-domain HTML (lxml required).
Usage: python import-quotes.py /path/to/pg48105-images.html
This preserves the anthology's attribution; it does not certify original authorship.
"""
from lxml import html
from pathlib import Path
import sys,re,json,hashlib
source=Path(sys.argv[1]);tree=html.parse(str(source));out=[];seen=set();pages={};page=''
for node in tree.iter():
 if (node.get('id') or '').startswith('page_'):page=node.get('id')
 if node.tag=='p':pages[node]=page
common=re.compile(r'\b(the|a|an|of|to|is|in|it|that|be|and|for|with|not|are|than|you|your|have|our|we)\b',re.I)
exclude=re.compile(r'\b(woman|women|wife|wives|sex|race|races|negro|nigger|jew|jews|heathen|savage|savages|slave|slavery|god|gods|christ|christian|devil|hell|heaven|jesus|church|bible|satan|papist|heretic|murder|suicide|harlot|whore|bastard)\b',re.I)
topics={'Finance':r'\b(money|wealth|rich|riches|poverty|profit|trade|commerce|economy|capital|debt|credit|price|cost|tax|gold|fortune)\b','Risk & strategy':r'\b(risk|danger|chance|luck|courage|caution|fortune|gambl|cards|play|hazard|bold|prudence|venture|loss|win|lose|uncertain|choice)\b','Judgment':r'\b(wise|wisdom|judgment|judgement|reason|knowledge|experience|learn|truth|error|think|thought|mind|decision)\b','Work & ambition':r'\b(work|labour|labor|industry|business|success|effort|time|perseverance|patience|purpose|ambition|opportunity|talent|skill|action)\b'}
for p in tree.xpath('//p[b and i]'):
 for n in p.xpath('.//span[@class="linenum"]'):n.drop_tree()
 b=re.sub(r'\s+',' ',' '.join(' '.join(n.itertext()) for n in p.xpath('./b'))).strip()
 author=re.sub(r'\s+',' ',' '.join(p.xpath('./i')[-1].itertext())).strip()
 # Use only the bold English quotation, never silently substitute a translation.
 if not 25<=len(b)<=650 or not 2<=len(author)<=95 or exclude.search(b):continue
 if len(common.findall(b)) < max(1,len(b.split())*.09):continue
 if re.search(r'\b(?:Pr|M|Gr|Lat|Fr|Ger|It|Sp|Gael|Sc|Anon)\.|\b(?:quoted|trans|after|from|on|in|of|to|by)\b',author):continue
 # A dash joining a foreign original and a translation is not a stand-alone English passage.
 if '—' in b and re.search(r'[àâçéèêëîïôùûüœäöß]',b):continue
 key=re.sub(r'\W+','',b).lower()
 if key in seen:continue
 seen.add(key)
 page=[pages.get(p,'')]
 tags=[k for k,v in topics.items() if re.search(v,b,re.I)] or ['Perspective']
 out.append({'id':hashlib.sha256(key.encode()).hexdigest()[:16],'text':b,'author':author.rstrip('.'),'topics':tags,'source':'https://www.gutenberg.org/cache/epub/48105/pg48105-images.html'+('#'+page[0] if page else '')})
# Prefer the requested subjects; the broader historical library is explicitly labelled.
out.sort(key=lambda q:(q['topics']==['Perspective'],-len(q['topics']),q['id']))
print('Eligible historical entries:',len(out))
if len(out)<10000:raise SystemExit('Not enough entries; do not pad or invent quotes')
out=out[:10000]
Path('apps/api/src/modules/quotes/library.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
Path('apps/api/src/modules/quotes/PROVENANCE.md').write_text(f'''# Historical quotation library

10,000 distinct passages selected from James Wood, *Dictionary of Quotations from Ancient and Modern, English and Foreign Sources*, 1893. Source: https://www.gutenberg.org/ebooks/48105 (downloaded 2026-10-23).

Source HTML SHA-256: `{hashlib.sha256(source.read_bytes()).hexdigest()}`.

The source edition is public domain; see the original scan's Public Domain Mark: https://wellcomecollection.org/works/nmrqaq25. Gutenberg credits Chuck Greif and the Online Distributed Proofreading Team. Original wording and the anthology's attribution are retained. Attribution is an assertion by that historical anthology, not independent verification of original authorship. Abbreviations are not expanded speculatively. Topic tags are editorial search aids, not source metadata. The collection includes finance, risk, judgment, work and broader reflections; it is not 10,000 quotations exclusively about finance.

The greeting rotates a separately reviewed shortlist; it does not randomly promote the entire historical corpus. No fake authors, generated quotations, duplicate padding, or invented Russian translations are used. Run `scripts/import-quotes.py` against the downloaded source to reproduce the library. The complete source and its terms remain accessible through the cited links.\n''')
from collections import Counter
print(Counter(t for q in out for t in q['topics']))
for q in out:
 if len(q['text'])<180 and q['topics'][0] in ['Finance','Risk & strategy'] and q['author'] in ['Bacon','Emerson','Carlyle','Seneca','Sen','Adam Smith','Franklin','Shakespeare','Johnson','Burke','Goethe','Locke','Plutarch','Horace','Hor','Euripides','Disraeli','Montaigne','La Rochefoucauld','Rochefoucauld']:print(json.dumps(q,ensure_ascii=False))

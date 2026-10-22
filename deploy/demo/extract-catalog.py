"""Read the supplied reference. Keep only method/currency/geography, never commercial identities."""
import json, re, sys
from pathlib import Path
import openpyxl

countries = dict(zip(
    'Argentina Australia Austria Azerbaijan Bangladesh Belgium Bolivia Brazil Bulgaria Canada Chile Colombia Costa_Rica Ecuador Egypt Gambia Ghana Guatemala Honduras India Indonesia Italy Japan Kazakhstan Kenya Malaysia Mexico Morocco Nepal Netherlands Nigeria Norway Pakistan Panama Peru Philippines Poland Portugal Senegal Singapore South_Africa South_Korea Sweden Switzerland Thailand Turkey Uzbekistan Venezuela Vietnam Zambia Luxembourg Germany Spain UK'.split(),
    'AR AU AT AZ BD BE BO BR BG CA CL CO CR EC EG GM GH GT HN IN ID IT JP KZ KE MY MX MA NP NL NG NO PK PA PE PH PL PT SN SG ZA KR SE CH TH TR UZ VE VN ZM LU DE ES GB'.split()))
base = dict(EUR=75,USD=85,GBP=65,ARS=85000,AUD=120,AZN=130,BDT=9000,BGN=145,BOB=520,BRL=380,CAD=115,CLP=72000,COP=320000,CRC=40000,EGP=3800,GHS=950,GMD=5500,GTQ=600,HNL=2000,IDR=1250000,INR=6500,JPY=11000,KES=10000,KRW=105000,KZT=38000,MAD=760,MXN=1500,MYR=350,NGN=120000,NPR=10500,PEN=290,PHP=4500,PKR=22000,PLN=320,SGD=105,THB=2800,TRY=3000,UZS=1000000,VES=6500,VND=2000000,XOF=48000,ZAR=1450,ZMW=2000)
zero = {'JPY','KRW','VND','CLP','XOF'}
rows = list(openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)['Все данные'].values)
catalog = {}
for row in rows[1:]:
    geo, method, cur = row[1], row[2], row[11]
    if not geo or not method or not cur: continue
    currencies = re.findall(r'\b[A-Z]{3}\b', str(cur))
    currencies = [c for c in currencies if c in base]
    codes = [countries[c.strip().replace(' ','_')] for c in str(geo).split(',') if c.strip().replace(' ','_') in countries]
    if not codes:
        if 'Europe' in geo or 'EU' in geo: codes = ['DE'] + (['GB'] if 'UK' in geo else [])
        elif geo == 'LATAM': codes = ['BR','MX','CO']
        else: continue
    # Classify the reference internally; publish fictional demo labels only.
    label = re.sub(r'\s*\([^)]*\)', '', str(method)).strip()
    low = label.lower()
    family = ('qr' if 'qr' in low else 'card' if any(x in low for x in ['card','visa','amex','e-com']) else 'open_banking' if any(x in low for x in ['open banking','klarna','trustly','ideal','eps','fpx']) else 'instant' if any(x in low for x in ['upi','pix','swish','promptpay','paynow','spei']) else 'bank_transfer' if any(x in low for x in ['bank','transfer','sepa','imps','virtual account','havale','eft','interac']) else 'wallet')
    for code in codes:
        for currency in currencies:
            if code=='GB' and currency=='EUR' and 'GBP' in currencies: continue
            if code!='GB' and currency=='GBP' and 'EUR' in currencies: continue
            key=(label,currency,code)
            catalog[key] = dict(method=label,family=family,currency=currency,country=code,base_minor=base[currency]*(1 if currency in zero else 100))
data=list(catalog.values())
labels=sorted({r["method"] for r in data})
words=["Aurora","Orbit","Prism","Nova","Pulse","Horizon","Vector","Crest"]
aliases={name:f"NATIO {words[i%len(words)]} {i+1:03}" for i,name in enumerate(labels)}
for row in data: row["method"]=aliases[row["method"]]
Path(__file__).with_name('method-catalog.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(combinations=len(data),methods=len({r['method'] for r in data}),currencies=len({r['currency'] for r in data}),countries=len({r['country'] for r in data}))))

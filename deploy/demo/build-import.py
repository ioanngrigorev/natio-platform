"""Produce a psql import. Default is a one-merchant rollback test; --apply commits 100 batches."""
import json, sys
from pathlib import Path
p=Path(__file__).parent
apply='--apply' in sys.argv
data=json.loads((p/'method-catalog.json').read_text())
print('\\set ON_ERROR_STOP on\n\\set QUIET on\nSELECT pg_advisory_lock(20251022);\nBEGIN;')
print('CREATE TEMP TABLE demo_catalog(n int, method text, family text, currency text, country text, base_minor bigint);')
def quote(x): return "'"+str(x).replace("'","''")+"'"
for i,r in enumerate(data,1):
 print('INSERT INTO demo_catalog VALUES ('+','.join([str(i)]+[quote(r[k]) for k in ['method','family','currency','country','base_minor']])+');')
print((p/'foundation.sql').read_text())
if apply: print('COMMIT;')
for i in range(1,101 if apply else 2):
 print(f"\\set merchant {i}\nSELECT count(*)=10000 AS batch_done FROM transactions WHERE merchant_id='mer_d25_{i:03}' AND mode='test' \\gset\n\\if :batch_done\n\\echo Merchant {i} already complete\n\\else")
 if apply: print('BEGIN;')
 print((p/'merchant.sql').read_text())
 print('COMMIT;' if apply else 'ROLLBACK;')
 print(f'\\echo Merchant {i} completed\n\\endif')
print('SELECT pg_advisory_unlock(20251022);')

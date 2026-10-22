CREATE TEMP TABLE demo_providers AS
SELECT i, 'prv_d25_'||lpad(i::text,5,'0') id, 'pa_d25_'||lpad(i::text,5,'0') account_id,
 'mer_d25_'||lpad(((i-1)/100+1)::text,3,'0') merchant_id,
 (ARRAY['Avelora','Orvessa','Lumera','Veloria','Noverin','Elvaris','Solveta','Mirevon','Asterin','Calvora'])[1+(i-1)%10]||' '||
 (ARRAY['Meridian','Orbit','Horizon','Harbor','Atlas','Summit','Prism','Aurora','Vector','Crest'])[1+((i-1)/10)%10]||' '||lpad(i::text,5,'0') name,
 c.*, (1.2+(i%39)*0.1)::numeric(8,4) fee_percent
FROM generate_series(1,10000) i JOIN demo_catalog c ON c.n=1+(i-1)%(SELECT count(*) FROM demo_catalog);

INSERT INTO merchants(id,name,legal_name,country,website,registration_number,contact_email,kyb_status,settings,created_at,updated_at)
SELECT 'mer_d25_'||lpad(m::text,3,'0'),
 (ARRAY['Avelora','Orvessa','Lumera','Veloria','Noverin','Elvaris','Solveta','Mirevon','Asterin','Calvora'])[1+(m-1)%10]||' '||
 (ARRAY['Market','Travel','Studio','Commerce','Learning','Retail','Digital','Games','Living','Experiences'])[1+(m-1)/10],
 'NATIO Demo Company '||m, p.country,'https://merchant-'||m||'.example','DEMO-2025-'||m,'owner'||m||'@merchant.example',
 (CASE WHEN m%10=0 THEN 'pending' ELSE 'approved' END)::kyb_status,
 jsonb_build_object('industry','Demo commerce','defaultCurrency',p.currency,'demo',true), '2025-01-01'::timestamptz,'2025-12-31'::timestamptz
FROM generate_series(1,100) g(m) JOIN demo_providers p ON p.i=(m-1)*100+1 ON CONFLICT DO NOTHING;

INSERT INTO merchant_users(id,merchant_id,email,name,role,status,last_login_at,created_at,updated_at)
SELECT 'usr_d25_'||lpad(i::text,3,'0'),m.id,m.contact_email,
 (ARRAY['Alex','Maya','Leo','Nora','Aria','Theo','Eva','Luca','Mila','Noah'])[1+(i-1)%10]||' '||
 (ARRAY['Avery','Rowan','Vale','Morgan','Reed','Blair','Ellis','Lane','Quinn','Hayes'])[1+(i-1)/10],
 'owner','active','2025-12-31 12:00Z'::timestamptz,'2025-01-01'::timestamptz,'2025-12-31'::timestamptz
FROM generate_series(1,100) i JOIN merchants m ON m.id='mer_d25_'||lpad(i::text,3,'0') ON CONFLICT DO NOTHING;

INSERT INTO providers(id,code,name,type,adapter_key,supported_methods,supported_currencies,supported_countries,capabilities,settlement_entity,description,created_at,updated_at)
SELECT id,'demo-'||lpad(i::text,5,'0'),name,
 (CASE family WHEN 'qr' THEN 'qr' WHEN 'wallet' THEN 'wallet' WHEN 'bank_transfer' THEN 'bank' WHEN 'open_banking' THEN 'open_banking' ELSE 'psp' END)::provider_type,
 CASE WHEN family='qr' THEN 'mock_qr' ELSE 'mock_acquirer' END,
 jsonb_build_array(family),jsonb_build_array(currency),jsonb_build_array(country),
 '{"payments":true,"refunds":true,"capture":true,"payouts":true,"hostedPage":true}',name||' Demo Ltd',
 'Fictional demo provider · '||method||' · '||country||' · '||currency,'2025-01-01'::timestamptz,'2025-12-31'::timestamptz
FROM demo_providers ON CONFLICT DO NOTHING;

INSERT INTO provider_accounts(id,provider_id,merchant_id,mode,name,priority,config,fee_percent,currencies,limits,created_at,updated_at)
SELECT account_id,id,merchant_id,'test',method||' · '||currency||' · '||country,100+i%100,
 jsonb_build_object('demo',true,'method',method,'country',country,'base_minor',base_minor,'simulation',jsonb_build_object('latencyMs',120+i%450)),
 fee_percent,jsonb_build_array(currency),jsonb_build_object('minAmount',base_minor/20,'maxAmount',base_minor*50),'2025-01-01'::timestamptz,'2025-12-31'::timestamptz
FROM demo_providers ON CONFLICT DO NOTHING;

INSERT INTO projects(id,merchant_id,name,slug,settings,created_at,updated_at)
SELECT DISTINCT merchant_id||'_'||currency,merchant_id,'Online · '||currency,'online-'||lower(currency),jsonb_build_object('defaultCurrency',currency,'demo',true),'2025-01-01'::timestamptz,'2025-12-31'::timestamptz
FROM demo_providers ON CONFLICT DO NOTHING;

INSERT INTO routing_rules(id,merchant_id,mode,name,description,priority,conditions,strategy,created_at,updated_at)
SELECT 'rr_d25_'||lpad(i::text,5,'0'),merchant_id,'test',method||' / '||country||' / '||currency,'Demo routing policy',i,
 jsonb_build_array(jsonb_build_object('field','currency','op','eq','value',currency),jsonb_build_object('field','country','op','eq','value',country),jsonb_build_object('field','payment_method','op','eq','value',family)),
 'ordered','2025-01-01'::timestamptz,'2025-12-31'::timestamptz
FROM demo_providers WHERE (i-1)%100<3 ON CONFLICT DO NOTHING;
INSERT INTO provider_routes(id,routing_rule_id,provider_account_id)
SELECT 'rt_d25_'||lpad(i::text,5,'0'),'rr_d25_'||lpad(i::text,5,'0'),account_id FROM demo_providers WHERE (i-1)%100<3 ON CONFLICT DO NOTHING;
INSERT INTO risk_rules(id,merchant_id,mode,name,description,conditions,action,score,created_at,updated_at)
SELECT 'risk_d25_'||right(id,3),id,'test','High velocity review','Synthetic demo rule', '[{"field":"velocity_1h","op":"gt","value":20}]','review',65,'2025-01-01'::timestamptz,'2025-12-31'::timestamptz
FROM merchants WHERE id LIKE 'mer_d25_%' ON CONFLICT DO NOTHING;
INSERT INTO webhook_endpoints(id,merchant_id,project_id,mode,url,description,secret_enc,secret_prefix,events,status,created_at,updated_at)
SELECT 'wh_d25_'||right(m.id,3),m.id,(SELECT min(id) FROM projects WHERE merchant_id=m.id),'test','https://merchant-'||right(m.id,3)||'.example/webhooks',
 'Demo callback history; endpoint disabled','demo-disabled-no-secret','demo_disabled','["payment.successful","payment.failed"]','disabled','2025-01-01'::timestamptz,'2025-12-31'::timestamptz
FROM merchants m WHERE m.id LIKE 'mer_d25_%' ON CONFLICT DO NOTHING;

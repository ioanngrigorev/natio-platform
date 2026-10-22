-- Complete linked detail views without changing the immutable ledger.
INSERT INTO customers(id,merchant_id,project_id,mode,external_id,email,name,country,metadata,created_at)
SELECT 'cus_'||a.id,a.merchant_id,a.merchant_id||'_'||(a.currencies->>0),'test','CUSTOMER-'||right(a.id,5),
 'customer-'||right(a.id,5)||'@demo.example','Demo customer '||right(a.id,5),a.config->>'country','{"demo":true}','2025-01-01'::timestamptz
FROM provider_accounts a WHERE a.merchant_id='mer_d25_'||lpad(:merchant::text,3,'0') AND a.id LIKE 'pa_d25_%' ON CONFLICT DO NOTHING;

INSERT INTO risk_decisions(id,payment_id,decision,score,signals,created_at)
SELECT 'rd_'||p.id,p.id,'allow',p.risk_score,'{"demo":true,"velocity_1h":3}',p.created_at
FROM payments p WHERE p.merchant_id='mer_d25_'||lpad(:merchant::text,3,'0') AND p.id LIKE 'pay_d25_%' AND p.risk_decision_id IS NULL ON CONFLICT DO NOTHING;
UPDATE payments SET risk_decision_id='rd_'||id WHERE merchant_id='mer_d25_'||lpad(:merchant::text,3,'0') AND id LIKE 'pay_d25_%' AND risk_decision_id IS NULL;

INSERT INTO routing_decisions(id,payment_id,strategy,rule_name,candidates,selected_provider_account_id,context,evaluated_at)
SELECT 'route_'||p.id,p.id,'score','Demo market selection',jsonb_build_array(jsonb_build_object('providerAccountId',a.id,'providerId',v.id,'providerName',v.name,'accountName',a.name,'score',92,'eligible',true,'reasons',jsonb_build_array('Currency and country match','Sandbox account'),'factors',jsonb_build_object('availability',1,'cost',0.9))),
 a.id,jsonb_build_object('demo',true,'country',p.country,'currency',p.currency,'amount',p.amount,'payment_method',p.payment_method_type),p.created_at+interval '0.2 seconds'
FROM payments p JOIN provider_accounts a ON a.id=p.provider_account_id JOIN providers v ON v.id=a.provider_id
WHERE p.merchant_id='mer_d25_'||lpad(:merchant::text,3,'0') AND p.id LIKE 'pay_d25_%' ON CONFLICT DO NOTHING;
UPDATE payments SET routing_decision_id='route_'||id,customer_id='cus_'||provider_account_id,test_scenario='historical_demo',
 next_action=CASE WHEN status='processing' THEN '{"type":"display_details","details":{"instruction":"Awaiting simulated payment confirmation"}}'::jsonb ELSE next_action END
WHERE merchant_id='mer_d25_'||lpad(:merchant::text,3,'0') AND id LIKE 'pay_d25_%';
INSERT INTO payment_events(id,payment_id,type,title,description,data,created_at)
SELECT 'created_'||id,id,'demo.created','Demo payment created','Historical 2025 transaction',jsonb_build_object('demo',true,'amount',amount,'currency',currency),created_at
FROM payments WHERE merchant_id='mer_d25_'||lpad(:merchant::text,3,'0') AND id LIKE 'pay_d25_%' ON CONFLICT DO NOTHING;

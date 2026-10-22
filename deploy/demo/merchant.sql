CREATE TEMP TABLE demo_ops ON COMMIT DROP AS
WITH x AS (
 SELECT j, p.*, lpad(:merchant::text,3,'0')||'_'||lpad(j::text,5,'0') suffix,
 CASE WHEN j%10=0 THEN 'payout' ELSE 'payment' END kind,
 CASE WHEN (j*37+(j/100)*13+:merchant*11)%100<90 THEN 'successful' WHEN (j*37+(j/100)*13+:merchant*11)%100<97 THEN 'failed' WHEN (j*37+(j/100)*13+:merchant*11)%100<99 THEN 'processing' ELSE 'pending' END state,
 floor(base_minor*(0.15+((j*73+:merchant*17)%1800)/400.0))::bigint amount,
 '2025-01-01 00:00Z'::timestamptz + (((j*7919+:merchant*101)%31449000)||' seconds')::interval event_at,
 180+(j*13)%1800 latency
 FROM generate_series(1,10000) j JOIN demo_providers p ON p.i=(:merchant-1)*100+1+(j-1)%100
)
SELECT *, CASE WHEN state='successful' THEN round(amount*fee_percent/100)::bigint ELSE 0 END fee,
 merchant_id||'_'||currency project_id, CASE WHEN kind='payment' THEN 'pay_d25_' ELSE 'po_d25_' END||suffix entity_id,
 'txn_d25_'||suffix txn_id, 'GW-2025-'||suffix gateway_ref,'ORD-2025-'||suffix external_ref,
 CASE WHEN kind='payment' AND state='successful' AND j%3=0 THEN 'set_d25_'||lpad(i::text,5,'0') ELSE NULL END settlement_id
FROM x;

INSERT INTO payments(id,merchant_id,project_id,mode,amount,currency,captured_amount,status,payment_method_type,country,description,reference,metadata,risk_score,current_attempt_id,attempt_count,provider_account_id,provider_id,provider_payment_id,fee_amount,failure_code,failure_message,processing_time_ms,created_at,updated_at,processed_at)
SELECT entity_id,merchant_id,project_id,'test',amount,currency,CASE WHEN state='successful' THEN amount ELSE 0 END,state::payment_status,family::payment_method_type,country,
 'Demo order · '||method,external_ref,jsonb_build_object('demo',true,'method',method,'channel','Online · '||currency,'owner_user_id','usr_d25_'||lpad(:merchant::text,3,'0')),
 CASE WHEN state='pending' THEN 65 ELSE j%35 END,'att_d25_'||suffix,1,account_id,id,gateway_ref,fee,
 CASE WHEN state='failed' THEN 'insufficient_funds' END,CASE WHEN state='failed' THEN 'Simulated decline' END,latency,event_at,event_at+interval '2 seconds',CASE WHEN state IN('successful','failed') THEN event_at+interval '2 seconds' END
FROM demo_ops WHERE kind='payment';
INSERT INTO payment_attempts(id,payment_id,attempt_number,provider_account_id,provider_id,status,outcome,provider_payment_id,provider_code,provider_message,fee_amount,request_sent_at,responded_at,latency_ms,raw_response,created_at,updated_at)
SELECT 'att_d25_'||suffix,entity_id,1,account_id,id,
 (CASE state WHEN 'successful' THEN 'succeeded' WHEN 'failed' THEN 'failed' ELSE 'processing' END)::attempt_status,
 (CASE state WHEN 'successful' THEN 'success' WHEN 'failed' THEN 'soft_decline' ELSE 'requires_action' END)::attempt_outcome,
 gateway_ref,CASE WHEN state='failed' THEN '51' ELSE '00' END,'Synthetic demo response',fee,event_at,CASE WHEN state IN('successful','failed') THEN event_at+interval '2 seconds' END,latency,'{"demo":true}',event_at,event_at+interval '2 seconds'
FROM demo_ops WHERE kind='payment';
INSERT INTO payouts(id,merchant_id,project_id,mode,amount,currency,status,destination,description,reference,country,provider_account_id,provider_id,provider_payout_id,fee_amount,metadata,created_at,updated_at,processed_at)
SELECT entity_id,merchant_id,project_id,'test',amount,currency,state::payout_status,jsonb_build_object('type','bank_account','display','DEMO ****'||lpad((j%10000)::text,4,'0'),'country',country,'currency',currency,'holderName','Demo recipient '||j),
 'Demo payout',external_ref,country,account_id,id,gateway_ref,fee,'{"demo":true}',event_at,event_at+interval '2 seconds',CASE WHEN state IN('successful','failed') THEN event_at+interval '2 seconds' END
FROM demo_ops WHERE kind='payout';
INSERT INTO transactions(id,merchant_id,project_id,mode,type,status,entity_type,entity_id,payment_id,attempt_id,amount,currency,fee_amount,net_amount,provider_account_id,provider_id,provider_reference,payment_method_type,country,processing_time_ms,failure_code,settlement_id,occurred_at,created_at)
SELECT txn_id,merchant_id,project_id,'test',kind::transaction_type,(CASE WHEN state IN('pending','processing') THEN 'pending' ELSE state END)::transaction_status,kind,entity_id,
 CASE WHEN kind='payment' THEN entity_id END,CASE WHEN kind='payment' THEN 'att_d25_'||suffix END,
 CASE WHEN kind='payment' THEN amount ELSE -amount END,currency,fee,(CASE WHEN kind='payment' THEN amount ELSE -amount END)-fee,
 account_id,id,gateway_ref,method,country,latency,CASE WHEN state='failed' THEN 'insufficient_funds' END,settlement_id,event_at+interval '2 seconds',event_at+interval '2 seconds'
FROM demo_ops;
INSERT INTO payment_events(id,payment_id,attempt_id,type,title,description,data,created_at)
SELECT 'pe_d25_'||suffix,entity_id,'att_d25_'||suffix,'demo.'||state,CASE state WHEN 'successful' THEN 'Payment completed' WHEN 'failed' THEN 'Payment declined' ELSE 'Awaiting confirmation' END,
 'Synthetic historical payment · '||method,jsonb_build_object('demo',true,'amount',amount,'currency',currency),event_at+interval '2 seconds'
FROM demo_ops WHERE kind='payment';
INSERT INTO state_transitions(id,entity_type,entity_id,from_status,to_status,reason,created_at)
SELECT 'st_d25_'||suffix,kind,entity_id,'created',state,'Synthetic demo history',event_at+interval '2 seconds' FROM demo_ops;
INSERT INTO risk_decisions(id,payment_id,decision,score,matched_rules,signals,created_at)
SELECT 'rd_d25_'||suffix,entity_id,'review',65,jsonb_build_array(jsonb_build_object('id','risk_d25_'||lpad(:merchant::text,3,'0'),'name','High velocity review','action','review','score',65)),
 '{"demo":true,"velocity_1h":24}',event_at FROM demo_ops WHERE kind='payment' AND state='pending';
UPDATE payments p SET risk_decision_id=r.id FROM risk_decisions r WHERE p.id=r.payment_id AND r.id LIKE 'rd_d25_'||lpad(:merchant::text,3,'0')||'_%';

INSERT INTO settlements(id,merchant_id,mode,provider_account_id,settlement_reference,currency,gross_amount,fee_amount,net_amount,transaction_count,period_start,period_end,status,source,settled_at,created_at)
SELECT settlement_id,merchant_id,'test',account_id,'STMT-2025-'||lpad(i::text,5,'0'),currency,sum(amount),sum(fee),sum(amount-fee),count(*),min(event_at),max(event_at)+interval '2 seconds','settled','provider_report','2025-12-31 12:00Z'::timestamptz,'2025-12-31 12:00Z'::timestamptz
FROM demo_ops WHERE settlement_id IS NOT NULL GROUP BY settlement_id,merchant_id,account_id,i,currency;
INSERT INTO settlement_items(id,settlement_id,transaction_id,amount,fee_amount,created_at)
SELECT 'si_d25_'||suffix,settlement_id,txn_id,amount,fee,'2025-12-31 12:00Z'::timestamptz FROM demo_ops WHERE settlement_id IS NOT NULL;
INSERT INTO reconciliation_batches(id,merchant_id,mode,provider_account_id,source,file_name,period_start,period_end,status,totals,created_at,completed_at)
SELECT 'rec_'||settlement_id,merchant_id,'test',account_id,'csv','demo-2025-'||i||'.csv',min(event_at),max(event_at)+interval '2 seconds','completed',
 jsonb_build_object('total',count(*),'MATCHED',count(*),'MISSING_PROVIDER',0,'MISSING_NATIO',0,'AMOUNT_MISMATCH',0,'STATUS_MISMATCH',0),'2025-12-31 13:00Z'::timestamptz,'2025-12-31 13:01Z'::timestamptz
FROM demo_ops WHERE settlement_id IS NOT NULL GROUP BY settlement_id,merchant_id,account_id,i;
INSERT INTO reconciliation_items(id,batch_id,status,transaction_id,payment_id,provider_reference,natio_amount,provider_amount,currency,natio_status,provider_status,notes,created_at)
SELECT 'ri_d25_'||suffix,'rec_'||settlement_id,'MATCHED',txn_id,entity_id,gateway_ref,amount,amount,currency,'successful','successful','Synthetic reconciliation sample','2025-12-31 13:01Z'::timestamptz
FROM demo_ops WHERE settlement_id IS NOT NULL;

INSERT INTO events(id,merchant_id,project_id,mode,type,entity_type,entity_id,data,created_at)
SELECT 'ev_d25_'||suffix,merchant_id,project_id,'test','payment.'||state,'payment',entity_id,jsonb_build_object('demo',true,'amount',amount,'currency',currency),event_at+interval '2 seconds'
FROM demo_ops WHERE kind='payment' AND j<=100 AND state IN('successful','failed');
INSERT INTO webhook_deliveries(id,endpoint_id,merchant_id,mode,event_id,event_type,payload,status,attempt_count,last_response_status,last_response_body,delivered_at,created_at,updated_at)
SELECT 'wd_d25_'||suffix,'wh_d25_'||lpad(:merchant::text,3,'0'),merchant_id,'test','ev_d25_'||suffix,'payment.'||state,jsonb_build_object('id',entity_id,'demo',true,'amount',amount,'currency',currency),
 'succeeded',1,200,'Synthetic callback acknowledged',event_at+interval '3 seconds',event_at+interval '2 seconds',event_at+interval '3 seconds'
FROM demo_ops WHERE kind='payment' AND j<=100 AND state IN('successful','failed');
INSERT INTO webhook_delivery_attempts(id,delivery_id,attempt_number,response_status,response_body,duration_ms,created_at)
SELECT 'wa_d25_'||suffix,'wd_d25_'||suffix,1,200,'Synthetic callback acknowledged',latency,event_at+interval '3 seconds'
FROM demo_ops WHERE kind='payment' AND j<=100 AND state IN('successful','failed');
INSERT INTO system_events(id,level,source,type,message,merchant_id,data,created_at)
SELECT 'sys_d25_'||lpad(:merchant::text,3,'0'),'info','demo','demo.statement_ready','2025 demo statement ready for '||name,id,'{"demo":true}','2025-12-31 14:00Z'::timestamptz FROM merchants WHERE id='mer_d25_'||lpad(:merchant::text,3,'0');
INSERT INTO audit_logs(id,actor_type,actor_label,merchant_id,action,entity_type,entity_id,after)
VALUES('audit_d25_'||lpad(:merchant::text,3,'0'),'system','NATIO demo importer','mer_d25_'||lpad(:merchant::text,3,'0'),'demo.imported','merchant','mer_d25_'||lpad(:merchant::text,3,'0'),'{"year":2025,"transactions":10000,"synthetic":true}');

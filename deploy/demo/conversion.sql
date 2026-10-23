-- Enrich existing synthetic 2025 entries only; do not create or change financial records.
-- One deterministic merchant-declared cohort per demo payment. Unknown remains a real segment.
UPDATE payments p SET traffic_type=CASE
 WHEN get_byte(decode(md5(p.id),'hex'),0)>=250 THEN 'unknown'
 WHEN get_byte(decode(md5(p.id),'hex'),0)<CASE WHEN p.status='failed' THEN 175 ELSE 90 END THEN 'ftd' ELSE 'std' END
WHERE p.mode='test' AND p.id ~ '^pay_d25_[0-9]{3}_[0-9]{5}$' AND p.metadata->>'demo'='true' AND p.traffic_type='unknown';
UPDATE transactions t SET traffic_type=p.traffic_type,conversion=jsonb_build_object(
 'source','synthetic','method_selected',true,'psp_submitted',true,
 'psp_approved',CASE WHEN t.status='successful' THEN true WHEN t.status='failed' THEN false ELSE NULL END,
 'completed',CASE WHEN t.status='pending' THEN NULL ELSE t.status='successful' END,
 'attempt_count',p.attempt_count,'latency_ms',t.processing_time_ms,'decline_reason',t.failure_code)
FROM payments p WHERE t.payment_id=p.id AND t.merchant_id=p.merchant_id AND t.mode='test' AND p.mode='test'
 AND t.type='payment' AND t.id ~ '^txn_d25_[0-9]{3}_[0-9]{5}$' AND p.metadata->>'demo'='true' AND t.conversion IS NULL;
-- All seeded payments already have a submitted PSP attempt. Their recorded selection success
-- is therefore 100%; we deliberately do not invent failed route selections or cascade attempts.
ANALYZE transactions;

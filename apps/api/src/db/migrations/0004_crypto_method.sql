-- A payment settled on a public chain, straight to the merchant's own wallet.
--
-- Added as an enum value rather than a separate table because it is a payment
-- like any other from the outside: same object, same timeline, same webhook
-- contract. What differs is internal — it has no provider, so it never enters
-- routing.
--
-- PostgreSQL 12 and later allow ADD VALUE inside a transaction as long as the
-- value is not also used there, which is why this migration only adds it.
ALTER TYPE "payment_method_type" ADD VALUE IF NOT EXISTS 'crypto';

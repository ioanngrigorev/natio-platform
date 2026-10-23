-- Additive role expansion preserves existing sessions and legacy operations accounts.
ALTER TYPE admin_role ADD VALUE IF NOT EXISTS 'administrator';
--> statement-breakpoint
ALTER TYPE admin_role ADD VALUE IF NOT EXISTS 'technical';
--> statement-breakpoint
ALTER TYPE admin_role ADD VALUE IF NOT EXISTS 'finance';

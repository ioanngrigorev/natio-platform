CREATE TABLE support_telegram_links (token_hash text PRIMARY KEY,admin_id text NOT NULL REFERENCES admin_users(id),expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE support_telegram_accounts (admin_id text PRIMARY KEY REFERENCES admin_users(id),chat_id text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE support_tickets (id text PRIMARY KEY,owner_id text NOT NULL REFERENCES admin_users(id),subject text NOT NULL,priority text NOT NULL CHECK(priority IN ('normal','urgent')),status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved')),page text NOT NULL DEFAULT '/admin',mode mode NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX support_tickets_owner_idx ON support_tickets(owner_id,updated_at DESC);
CREATE TABLE support_messages (id text PRIMARY KEY,ticket_id text NOT NULL REFERENCES support_tickets(id),author_id text NOT NULL REFERENCES admin_users(id),body text NOT NULL,origin text NOT NULL CHECK(origin IN ('web','telegram')),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX support_messages_ticket_idx ON support_messages(ticket_id,created_at);
CREATE TABLE support_telegram_updates (id bigint PRIMARY KEY,received_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE support_outbox (id text PRIMARY KEY,chat_id text NOT NULL,body text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),attempts integer NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX support_outbox_pending_idx ON support_outbox(status,next_at);

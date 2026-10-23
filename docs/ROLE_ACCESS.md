# Role access and isolated testing

The API is the authorization boundary. Hiding navigation is a usability aid;
manual URLs, direct HTTP calls and AI proposals do not bypass permissions.

| Role | Responsibility | Restricted actions |
| --- | --- | --- |
| Superadmin | Staff access and every platform area | Own role/status cannot be changed through the staff endpoint |
| Administrator | Merchant onboarding, risk and operational support | Staff grants, provider credentials, pricing and settlement writes |
| Technical manager | Providers, routing, diagnostics, integrations and development delivery | Finance administration, settlements and staff grants |
| Financial manager | Pricing, balances, receipts, reconciliation and settlements | Provider setup, routing, platform diagnostics and staff grants |
| Merchant owner | Its organization's payments, integrations, team and plan features | Other merchants and internal administration |
| Read-only observer | Cross-platform inspection for investor/reviewer demonstrations | Platform configuration and operational writes |

Read-only users can save their own analytical views and use simulations/AI;
these do not alter payment processing. Plan entitlements apply in addition to
merchant roles. Existing `operations` and `support` roles remain compatible;
new staff should receive the focused role matching their duties.

`adminReadPermission` guards sensitive resource families. Individual mutation
routes also declare the action permission. API and frontend permission maps
have a parity test. Tests attempt forbidden direct requests, self-promotion,
financial writes and technical writes with the wrong role.

## Demo deployment

`demo.natio.me` uses `docker-compose.demo.yml`, a separate PostgreSQL instance,
Redis, encryption/session secrets and distinct host-only session cookies.
Only the reverse proxy shares its edge network; demo containers do not join
the production database network. `NATIO_SANDBOX_ONLY` forces Test mode, rejects
live key issuance and live money movement, and rejects non-simulated adapters.
This is defense in depth, not a replacement for database isolation.

Provisioning order on a new empty demo deployment:

1. Set private `.env` values, including independently generated database,
   encryption, session and seed secrets (seed password at least 24 characters).
2. Start demo PostgreSQL/Redis; run the migration profile.
3. Import `python3 deploy/demo/build-import.py --apply --sandbox` and the
   synthetic detail/conversion fixtures. The sandbox importer checks the DB name.
4. Run `provision`, with a writable private volume at `/run/natio-demo`.
5. Start API/web and verify HTTPS, health, tenant boundaries and every login.

Provisioning refuses an existing credential file. It creates six unique random
passwords in a mode-0600 file, disables seed illustration accounts and never
prints secrets. Do not run the provisioner against production or share the
credential file in a repository, ticket or public URL. Reset credentials through
an explicit operator procedure; rerunning provisioning is not a password reset.

The demo and production still share one physical host. Container separation is
not high availability. Resource pressure, host outages and host compromise affect
both; production-grade redundancy requires additional infrastructure.

# Agent delivery from Development Center

A delivery manager opens a saved, reviewed **actual** task in `todo` or `in_progress`,
then selects Delivery → Start agents. The request freezes the title, specification
and Definition of Done. It creates one durable run and records its requester.
No coding process is started inside the financial API or webhook worker.

The standalone controller runs a coding agent, an independent read-only review,
then type checks, API/web regressions and production builds. Agent and test
processes run in resource-limited containers without Docker, SSH or production
database credentials. Docker is the outer sandbox: non-root UID, read-only root,
no capabilities, no privilege escalation, an internal network and only the
disposable checkout mounted. The reviewer gets a read-only checkout. Codex uses
`danger-full-access` **inside this boundary only** because nested user namespaces
are unavailable on hardened Docker hosts; host security settings are not relaxed.
Tests use a disposable loopback PostgreSQL instance with
network disabled. The installed Codex CLI uses a short-lived authenticated Responses API proxy.
The existing OpenAI key stays in the controller; containers receive only an
ephemeral capability, limited to 40 requests and 8,192 output tokens per request
per stage, revoked when the stage ends. Tests clean ignored artifacts and restore dependencies from the trusted image before running; agents may add tests but cannot weaken existing regression files.
The runner must be operated as trusted
infrastructure: membership in the Docker group is host-level privilege.

Test deployments queue automatically after checks pass. Production runs require
Live mode and explicit superadmin approval of the exact tested commit. The
separate deployment hook builds from a Git archive, rejects an advanced base,
updates only configured services, verifies image IDs and health, and restores
previous images if health fails. After health verification it advances the
configured repository branch to the tested SHA with an exact-base lease; a
rejected push also rolls the application back. Test and production use separate
branches, so a test release cannot move production `main`. No agent-generated shell command is accepted by
HTTP. Protected changes (dependencies, infrastructure, migrations, authentication
controller files and existing regression tests) require normal reviewed delivery instead.

## Installation

Use a dedicated Linux runner with Docker and adequate build memory. Do not mount
production files or the Docker socket into the agent containers. The runner's
controller checkout and `/etc/natio-agents` must not be inside run workspaces.

Create the isolated bridge once with `docker network create --internal natio-agents`.
The controller refuses a non-internal network. Its short-lived proxy binds only
to that bridge gateway on `proxyPort` (default 18765). Permit TCP to that port
from the agent bridge subnet in the host firewall, never from public interfaces; do not publish any application or financial service on that
bridge. Agent containers have no direct external network access.

1. Apply migration `0018_development_runs`, build the API and web, and deploy them
   normally. Keep `NATIO_AGENT_RUNS_ENABLED` unset until the runner is ready.
2. Build `deploy/agents/Dockerfile` from the trusted revision, with
   `--build-arg CODEX_VERSION=0.164.0`. Publish it to the organization's registry;
   use its `name@sha256:...` digest (or the immutable local `sha256:...` image ID) in `runner.json`. Dependency changes require a
   new trusted runtime image; the entrypoint compares the candidate lockfile with
   the image lockfile and refuses mismatches. Do not use mutable tags.
3. Copy the example runner JSON to `/etc/natio-agents/runner.json`. Copy the built
   controller to `/opt/natio-agent-controller`. Install the systemd unit and
   replace the Node executable path if needed. The optional `model` field pins a
   supported Codex model; omitting it uses the installed CLI's default.
4. Securely supply the **existing** `OPENAI_API_KEY` and a dedicated
   `NATIO_AGENT_DATABASE_URL` via the service environment file, mode 0600. Never
   put these in the candidate checkout. Use TLS or a private tunnel to PostgreSQL.
   The runner role needs SELECT/UPDATE on `development_runs`,
   SELECT/UPDATE on `development_items`, INSERT on `development_events` and
   SELECT/INSERT on `development_run_events`, plus their sequence USAGE and SELECT/INSERT/UPDATE on `development_runner_status`.
5. Install `deploy-compose.py` outside the checkout. Install two fixed wrappers
   for Test and production; each sets `NATIO_DEPLOY_CONFIG` to its own trusted
   config file and execs the hook with its four arguments. The configuration
   contains `project`, `env_file`, `compose_file`, `revision_file`,
   `release_override`, `publish_remote`, `publish_branch`, `services` (service → `api` or `web`) and optional
   `build_args` by image kind. All paths are absolute. Example Test services:
   `{"demo-api":"api","demo-web":"web"}`. Provision `testRef` (default `codex/agent-test`) from the tested baseline first;
   the Test hook publishes only that branch and the production hook only `ref`.
   Supply push credentials only to the trusted hook through its fixed wrapper.
   Disable competing pull-based auto-deploy timers for targets owned by this
   controller. Initial revision files must contain
   the full revision actually deployed; coordinate all other release processes
   with this lock/revision marker. Include the saved release override in future
   Compose operations so an operator restart cannot revert the release.
6. The supplied Compose hook runs on the deployment host. If the controller is
   elsewhere, use an operator-owned transport wrapper that transfers the Git
   bundle and invokes this hook through a restricted deployment identity. Never
   expose that identity to the agent containers.
7. Start the runner, enable `NATIO_AGENT_RUNS_ENABLED=true` only on the intended
   authenticated non-demo API, and verify an isolated task before normal use.
   Public sandbox instances are forbidden from launching agents even when enabled.
   The API checks the runner heartbeat before accepting new work.

Run the controller locally with `pnpm --filter @natio/api agent:runner` after
supplying its configuration. It uses its own database URL, not the financial
worker's configuration.

## Failure and audit semantics

Run IDs make duplicate HTTP submissions idempotent. A partial unique index and
row/advisory locks prevent overlapping task runs. While a run is active the
specification and lifecycle cannot change. A dedicated advisory lock serializes
runner execution; each claim gets a fencing token. Cancellation terminates the
active container before later stages. Deployment cannot be cancelled midway
through the UI. A lost controller marks active work interrupted and never
replays a deployment automatically. Inspect running containers, images and the
revision marker before starting a replacement run.

The UI displays stage events, the bounded source diff and commit IDs only to delivery managers. The production approval button requires opening the exact run diff first. Raw agent
and shell output is excluded from HTTP responses. Private diagnostics stay in
`root/diagnostics` with mode 0600 for the controller operator; they may contain
task details and must follow the organization's retention policy.
The run snapshot and lease token never leave the API. Success records release
evidence and leaves the task in review; the owner still verifies business
acceptance before marking Done. Agent runs are not charged as assistant credits;
API consumption is billed to the configured OpenAI account.

## Verification

`development-runs.test.ts` unit and integration suites cover authorization,
CSRF, isolation, concurrent idempotency, cancellation, fencing and exact-commit
production approval. Execute the integration suite only against a disposable
loopback `natio_test` database. Actual Docker/Codex/provider and rollout checks
must be recorded separately; mocked state transitions are not a live release.

Official execution reference: https://developers.openai.com/codex/noninteractive

## Validation dependency prerequisite

The release updates Zod to 4.6.6 and supplies explicit string-key schemas for
records. CI previously stopped on GHSA-mrhx-c7xc-m3w5. A regression verifies that
an oversized constrained array does not allocate a validation issue per element.
See https://github.com/advisories/GHSA-mrhx-c7xc-m3w5.

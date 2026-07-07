# CLAUDE.md — @otosheets/core

> **First port of call for AI agents.** Read this entire file before making changes.

## Working Conventions

- **Always run the build after making changes.** Run `npm run build` before considering the task complete. Fix any errors before moving on.
- After pushing changes, update the commit hash in every consuming repo's `package.json` and run `npm install` in each.


---

## 1. Project Purpose

Shared **data layer** for the Otosheets platform — repository classes, Zod schemas, and
**two storage backends**: a Postgres (Neon) layer (Drizzle schema in `src/pg/`, migrations
in `drizzle/`) and the original DynamoDB ports-adapters client (`ddbPort`/`ddbAdapter`/`ddb`).

> **Postgres is the canonical source of truth for the relational core** (as of 2026-07-06,
> `dual_pg` in dev + prod). Each domain repo (`UserRepo`, `InvoiceRepo`, …) is a **routing
> wrapper** that reads a per-domain SSM flag (`/otosheets/{env}/data-backend/{domain}` via
> `src/dataBackend.ts`) and dispatches to the Postgres impl (`*PgRepo`) or DynamoDB impl
> (`*DynamoRepo`), mirroring writes to the other store. In `dual_pg`, Postgres is
> authoritative and DynamoDB is the rollback mirror. Consumers call the same repo methods
> and get the same DTOs regardless of backend. Full design:
> `docs/POSTGRES_MIGRATION_PLAN.md` in the `otosheets` monorepo.

Consumed by:

- `otosheets-app-backend` — all handler business logic
- `otosheets-agents` — workflow run/execution log persistence
- `otosheets-external-mcp` — user record lookups (Gmail OAuth tokens)

---

## 2. Architecture

Each domain repo routes between two backends on the per-domain cutover flag:

```
                 UserRepo / InvoiceRepo / …   (routing wrapper, factory.ts)
                     |  resolveRoute(domain) → reads SSM flag (dataBackend.ts)
        ┌────────────┴─────────────┐
   *DynamoRepo                  *PgRepo
   (repo.ts, IDdb adapter)      (repo.pg.ts, Drizzle over Neon)
        └── mirror ◄── dual-write ──► mirror ──┘
```

- **`dual_pg`** (current, dev+prod): `*PgRepo` authoritative for reads/writes; every write
  mirrors to DynamoDB. **`dual_dynamo`**: the reverse. **`dynamo`/`pg`**: single-store.
- Writes needing a transaction (invoice + line items, payment + invoice roll) use the
  neon-serverless WebSocket driver via `getPgTx()`; other paths use the `neon-http` `getPg()`.

Each domain folder (`src/user/`, `src/invoice/`, etc.) contains:
- `schema.ts` — Zod DTO schema + TypeScript type (the store-agnostic contract)
- `repo.ts` — `I{Entity}Repo` interface + `{Entity}DynamoRepo` (DynamoDB impl)
- `repo.pg.ts` — `{Entity}PgRepo` (Postgres impl)
- `factory.ts` — the routing `{Entity}Repo` wrapper + `get{Entity}Repo()`
- `index.ts` — re-exports all of the above

DynamoDB table names are read from env vars at runtime (`src/tables.ts`); the Postgres
connection URL comes from `DATABASE_URL` (the consumer resolves the Neon secret and sets it).

---

## 3. Structure

```
otosheets-core/
├── src/
│   ├── index.ts              # Root re-exports
│   ├── ddbPort.ts            # IDdb port interface
│   ├── ddbAdapter.ts         # DynamoDbAdapter implementation
│   ├── ddbClient.ts          # Singleton ddb instance
│   ├── tables.ts             # Table name resolution from env vars
│   ├── keys.ts               # Sort key helpers (e.g. workflowRunSk, execLogSk)
│   ├── schemas.ts            # Shared schema utilities
│   ├── types.ts              # Shared types
│   │
│   ├── user/                 # UserRepo — getUser, updateUser
│   ├── org/                  # OrgRepo — getOrg, updateOrg
│   ├── membership/           # MembershipRepo — listOrgMembers, createMembership
│   ├── team/                 # TeamRepo — getTeam, listTeams, createTeam, updateTeam
│   ├── client/               # ClientRepo — CRUD
│   ├── invoice/              # InvoiceRepo — CRUD + overdue queries
│   ├── invoicePayment/       # InvoicePaymentRepo — listPayments, recordPayment
│   ├── job/                  # JobRepo — CRUD + date queries
│   ├── booking/              # BookingRepo — CRUD + date queries
│   ├── timeEntry/            # TimeEntryRepo — CRUD
│   ├── receipt/              # ReceiptRepo — CRUD + date queries
│   ├── trip/                 # TripRepo — listAllOrgTrips
│   ├── statement/            # StatementRepo — listStatements
│   ├── lead/                 # LeadRepo — CRUD + stage queries
│   ├── pipeline/             # PipelineRepo — CRUD + default pipeline
│   ├── ad/                   # AdRepo — CRUD
│   ├── conversation/         # ConversationRepo — getConversation, listConversations
│   ├── compliance/           # ComplianceRepo — getPlaybook, listTasks
│   ├── notification/         # NotificationRepo — listNotifications, createNotification
│   ├── orgChannel/           # OrgChannelRepo — getChannel, listChannels
│   ├── integration/          # IntegrationRepo — getIntegration, listIntegrations (also stores Xero/MYOB tokens under provider='accounting')
│   ├── accountingSync/       # AccountingSyncRepo — Xero/MYOB sync-state (idempotency); table created by external-mcp stack
│   ├── onboardingRun/        # WorkflowRunRepo (legacy name: OnboardingRunRepo)
│   ├── onboardingWorkflow/   # WorkflowRepo (legacy name: OnboardingWorkflowRepo)
│   └── welcomeEmail/         # WelcomeEmailRepo
│
├── package.json
└── tsconfig.json
```

---

## 4. Idempotency (Hard Requirement)

This repo is the data layer — it is the last line of defence against duplicate writes. Every trigger upstream (webhooks, crons, SQS, S3, client retries, agent replays) is at-least-once, so repo methods must reject duplicates rather than trusting callers to be perfect. Full platform standard: `docs/standards/07-idempotency.md` in the `otosheets` monorepo.

Rules for all repo code:

1. **Creates use `ConditionExpression: 'attribute_not_exists(sk)'`** (or the table's PK). Callers treat `ConditionalCheckFailedException` as "already done", not as an error. Unconditional `put()` on create paths silently overwrites on retry (e.g. can clobber `stripeCustomerId` during onboarding).
2. **Ledger/financial writes use `transactWrite` with a conditional dedupe item** — reference: `src/voiceCredit/repo.ts` `credit()`, which keys the ledger entry on the Stripe session ID with `attribute_not_exists(sk)` and updates the balance with atomic `ADD` in the same transaction. A replayed webhook cancels the whole transaction cleanly.
3. **Counters and balances use atomic `ADD` expressions** — never read-modify-write, which double-counts under replay and loses updates under concurrency.
4. **Prefer caller-supplied deterministic IDs** for records minted from external triggers (Stripe payment intent ID, S3 key, `templateId#period`) over generating a fresh ULID inside the repo — random IDs make every replay look like a new record and defeat dedupe.
5. Any new method reachable from a webhook, queue, or cron must answer: **"What happens if this is called twice with the same arguments?"** The correct answer is a failed condition or a no-op, never a second record.

Known violations (e.g. `invoicePayment/repo.ts` `recordPayment`, `org/repo.ts` `createOrg`, `membership/repo.ts` `createMembership`) are tracked in the monorepo's `docs/IDEMPOTENCY_AUDIT_2026-07-03.md` — fix them when touched.

---

## 5. Adding a New Repo Method

For a **migrated (routed) domain** add the method in FOUR places so both backends and the
router agree: the `I{Entity}Repo` interface + `{Entity}DynamoRepo` (`repo.ts`), the
`{Entity}PgRepo` (`repo.pg.ts`), and the routing `{Entity}Repo` wrapper (`factory.ts`).
For a **DynamoDB-only** domain (messages, notifications, etc.) just the one `repo.ts` class.

1. Open `src/{entity}/repo.ts` — add to the interface + Dynamo impl
2. Add the same method to `src/{entity}/repo.pg.ts` (Drizzle) — return the identical DTO
3. Add the routing passthrough in `src/{entity}/factory.ts` (read + shadow, or write + mirror)
4. If you need a new Zod schema field, update `src/{entity}/schema.ts` **and** the Drizzle
   column in `src/pg/schema/*` + a `drizzle/00NN_*.sql` migration (sparse-safe: no
   `NOT NULL DEFAULT` on fields DynamoDB stores sparsely)
5. Export from `src/{entity}/index.ts` if not already
6. `npm run build` && `npx vitest run`
6. Push, grab the commit hash
7. Update consumers' `package.json`: `"@otosheets/core": "github:Otomatik-Robotics/otosheets-core#<new-hash>"`
8. `npm install` in each consumer

---

## 6. Adding a New Entity / Repo

**Decide the store first** (see the dividing rule in the monorepo CLAUDE.md "Source of
Truth"): relational/joined/reported-on → Postgres-backed (routed); keyed/ephemeral/TTL →
DynamoDB-only.

DynamoDB-only entity:
1. `src/{entity}/schema.ts` — Zod schema + type
2. `src/{entity}/repo.ts` — repository class (accepts `IDdb` in constructor)
3. `src/{entity}/index.ts` re-exporting both; add the table to `src/tables.ts`; export from `src/index.ts`; `npm run build`

Postgres-backed (routed) entity — additionally:
4. Drizzle table in `src/pg/schema/{group}.ts` (sparse-safe) + a `drizzle/00NN_*.sql` migration
5. `src/{entity}/repo.ts` — extract an `I{Entity}Repo` interface; name the Dynamo class `{Entity}DynamoRepo`
6. `src/{entity}/repo.pg.ts` — `{Entity}PgRepo` returning DTO-identical rows
7. `src/{entity}/factory.ts` — routing `{Entity}Repo` wrapper on the domain flag + `get{Entity}Repo()`
8. Add the domain to `DataDomain` in `src/dataBackend.ts`; PGlite tests in `src/pg/*.test.ts`

---

## 7. Adding a New Endpoint — This Repo's Role

This repo is **Step 1** in the cross-repo endpoint process. It provides the DynamoDB data layer.

When a new endpoint needs a new repo method:

1. Add the method to `src/{entity}/repo.ts`
2. Export from `src/{entity}/index.ts` → `src/index.ts`
3. `npm run build`, push, grab the commit hash
4. Update consumers' `package.json` and `npm install`

If the existing repo already has the methods you need, skip this repo entirely.

**Full process (all repos):**

| Step | Repo | What |
|------|------|------|
| 1. Data layer | **`@otosheets/core` (this repo)** | Add DynamoDB repo methods |
| 2. Handler | `otosheets-app-backend` | Business logic + route registration in handler router |
| 3. Contract | `@otosheets/shared` | Endpoint path + cache tags in `query/endpoints.ts` |
| 4. Frontend | `otosheets-app-frontend` | `useMutate()` hook (if frontend calls it directly) |
| 5. MCP tool | `otosheets-domain-mcp` | Agent-callable tool wrapper (calls backend REST API, not DynamoDB) |
| 6. Agent config | `otosheets-agents` | Add to `READ_ONLY` set in `mcpBridge.ts` (if read-only) |

See `otosheets/CLAUDE.md` § "New API Endpoint (Full Cross-Repo Process)" for the detailed guide.

---

## 8. Commands

```bash
npm install
npm run build    # tsc -> dist/
```

Push source only. `dist/` is gitignored — consumers build it on install via the `prepare` hook.

---

## 9. Consumers

| Repo | How it's installed | What it uses |
|------|--------------------|-------------|
| `otosheets-app-backend` | `"@otosheets/core": "github:Otomatik-Robotics/otosheets-core#<hash>"` | All repos — handler business logic |
| `otosheets-agents` | Same | WorkflowRunRepo, WorkflowApprovalRepo |
| `otosheets-external-mcp` | Same | UserRepo (Gmail OAuth token lookup) |

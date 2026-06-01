# CLAUDE.md — @otosheets/core

> **First port of call for AI agents.** Read this entire file before making changes.

## Working Conventions

- **Always run the build after making changes.** Run `npm run build` before considering the task complete. Fix any errors before moving on.
- After pushing changes, update the commit hash in every consuming repo's `package.json` and run `npm install` in each.


---

## 1. Project Purpose

Shared DynamoDB data layer for the Otosheets platform. Provides repository classes, Zod schemas, and a ports-adapters DynamoDB client. Consumed by:

- `otosheets-app-backend` — all handler business logic
- `otosheets-agents` — workflow run/execution log persistence
- `otosheets-external-mcp` — user record lookups (Gmail OAuth tokens)

---

## 2. Architecture

```
IDdb (port interface)
  ^
  |  implements
DynamoDbAdapter (wraps DynamoDBDocumentClient)
  ^
  |  injected into
Repos (UserRepo, InvoiceRepo, etc.)
```

Each domain folder (`src/user/`, `src/invoice/`, etc.) contains:
- `schema.ts` — Zod schema + TypeScript type
- `repo.ts` — Repository class
- `index.ts` — Re-exports both

Table names are read from environment variables at runtime (see `src/tables.ts`).

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
│   ├── integration/          # IntegrationRepo — getIntegration, listIntegrations
│   ├── onboardingRun/        # WorkflowRunRepo (legacy name: OnboardingRunRepo)
│   ├── onboardingWorkflow/   # WorkflowRepo (legacy name: OnboardingWorkflowRepo)
│   └── welcomeEmail/         # WelcomeEmailRepo
│
├── package.json
└── tsconfig.json
```

---

## 4. Adding a New Repo Method

1. Open `src/{entity}/repo.ts`
2. Add the method to the repo class
3. If you need a new Zod schema field, update `src/{entity}/schema.ts`
4. Export from `src/{entity}/index.ts` if not already
5. `npm run build`
6. Push, grab the commit hash
7. Update consumers' `package.json`: `"@otosheets/core": "github:Tinago95/otosheets-core#<new-hash>"`
8. `npm install` in each consumer

---

## 5. Adding a New Entity / Repo

1. Create `src/{entity}/schema.ts` with Zod schema + TypeScript type
2. Create `src/{entity}/repo.ts` with the repository class (accepts `IDdb` in constructor)
3. Create `src/{entity}/index.ts` that re-exports both
4. Add the table name to `src/tables.ts`
5. Export from `src/index.ts`
6. `npm run build`

---

## 6. Adding a New Endpoint — This Repo's Role

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

## 7. Commands

```bash
npm install
npm run build    # tsc -> dist/
```

Push source only. `dist/` is gitignored — consumers build it on install via the `prepare` hook.

---

## 8. Consumers

| Repo | How it's installed | What it uses |
|------|--------------------|-------------|
| `otosheets-app-backend` | `"@otosheets/core": "github:Tinago95/otosheets-core#<hash>"` | All repos — handler business logic |
| `otosheets-agents` | Same | WorkflowRunRepo, WorkflowApprovalRepo |
| `otosheets-external-mcp` | Same | UserRepo (Gmail OAuth token lookup) |

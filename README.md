# @otosheets/core

Shared DynamoDB data layer for the Otosheets platform. Provides repository classes, Zod schemas, and a ports-adapters DynamoDB client used by both `otosheets-app-backend` and `otosheets-agents`.

## Install

```bash
npm install github:Tinago95/otosheets-core
```

npm clones the repo, installs dependencies, and runs `tsc` automatically via the `prepare` lifecycle hook. No pre-built `dist/` is committed.

## Usage

```typescript
import { ddb, UserRepo, InvoiceRepo } from '@otosheets/core';

const userRepo = new UserRepo(ddb);
const user = await userRepo.getUser(userId);

const invoiceRepo = new InvoiceRepo(ddb);
const invoices = await invoiceRepo.listAllOrgInvoices(orgId);
```

`ddb` is a singleton `DynamoDbAdapter` that wraps `DynamoDBDocumentClient`. All repos accept an `IDdb` port interface, so you can inject a mock for testing.

## Repos

| Repo | Table | Key methods |
|------|-------|-------------|
| `UserRepo` | Users | `getUser`, `updateUser` |
| `OrgRepo` | Organizations | `getOrg`, `updateOrg` |
| `MembershipRepo` | OrgMembers | `listOrgMembers`, `listUserOrgs`, `createMembership`, `updateMembership` |
| `TeamRepo` | Teams | `getTeam`, `listTeams`, `createTeam` |
| `IntegrationRepo` | Integrations | `getIntegration`, `listIntegrations` |
| `ClientRepo` | Clients | `getClient`, `listClients`, `createClient`, `updateClient`, `deleteClient` |
| `InvoiceRepo` | Invoices | `getInvoice`, `listAllOrgInvoices`, `listOverdueInvoices`, `createInvoice`, `updateInvoice`, `deleteInvoice` |
| `InvoicePaymentRepo` | InvoicePayments | `listPayments`, `recordPayment` |
| `JobRepo` | Jobs | `getJob`, `listAllOrgJobs`, `listJobsByDate`, `createJob`, `updateJob`, `deleteJob` |
| `BookingRepo` | Bookings | `getBooking`, `listBookingsByDate`, `createBooking`, `updateBooking` |
| `TimeEntryRepo` | TimeEntries | `listAllOrgTimeEntries`, `createTimeEntry`, `updateTimeEntry`, `deleteTimeEntry` |
| `ReceiptRepo` | Receipts | `listAllOrgReceipts`, `listReceiptsByDate`, `updateReceipt`, `deleteReceipt` |
| `TripRepo` | Trips | `listAllOrgTrips` |
| `StatementRepo` | Statements | `listStatements` |
| `LeadRepo` | Leads | `getLead`, `listAllOrgLeads`, `listLeadsByStage`, `createLead`, `updateLead` |
| `PipelineRepo` | Pipelines | `getPipeline`, `listPipelines`, `getDefaultPipeline`, `createPipeline`, `updatePipeline`, `deletePipeline` |
| `AdRepo` | Ads | `getAd`, `listAllOrgAds`, `createAd`, `updateAd`, `deleteAd` |
| `ConversationRepo` | Conversations | `getConversation`, `listConversations` |
| `ComplianceRepo` | Compliance | `getPlaybook`, `listTasks` |
| `NotificationRepo` | Notifications | `listNotifications`, `createNotification` |
| `OrgChannelRepo` | OrgChannels | `getChannel`, `listChannels` |

## Architecture

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
- `schema.ts` -- Zod schema + TypeScript type
- `repo.ts` -- Repository class
- `index.ts` -- Re-exports both

Table names are read from environment variables at runtime (see `src/tables.ts`).

## Peer dependencies

These must be installed in the consuming project:

```json
{
  "@aws-sdk/client-dynamodb": "^3.0.0",
  "@aws-sdk/lib-dynamodb": "^3.0.0",
  "zod": "^3.22.0 || ^4.0.0"
}
```

## Adding a New Endpoint — This Repo's Role

This repo is **Step 1** in the cross-repo endpoint process. It provides the DynamoDB data layer.

When a new endpoint needs a new repo method:

1. Add the method to `src/{entity}/repo.ts`
2. Export from `src/{entity}/index.ts` → `src/index.ts`
3. `npm run build`, push, grab the commit hash
4. Update consumers' `package.json`: `"@otosheets/core": "github:Tinago95/otosheets-core#<new-hash>"`
5. `npm install` in each consumer (`otosheets-app-backend`, `otosheets-agents`, `otosheets-external-mcp`)

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

## Development

```bash
npm install
npm run build    # tsc -> dist/
```

Push source only. `dist/` is gitignored -- consumers build it on install via the `prepare` hook.

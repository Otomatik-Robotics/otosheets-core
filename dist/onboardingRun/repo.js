"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowApprovalRepo = exports.OnboardingRunRepo = exports.WorkflowRunRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class WorkflowRunRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async get(orgId, membershipId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.ONBOARDING, {
            orgId,
            sk: (0, keys_1.onboardingRunSk)(membershipId),
        });
        return Item ?? null;
    }
    async list(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'ONBOARDING#' },
        });
        return Items ?? [];
    }
    async put(orgId, run) {
        const sk = run.membershipId
            ? (0, keys_1.onboardingRunSk)(run.membershipId)
            : (0, keys_1.workflowRunSk)(run.runId);
        await this.ddb.put(tables_1.Tables.ONBOARDING, { orgId, sk, ...run });
    }
    async listRuns(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'RUN#' },
        });
        return Items ?? [];
    }
    async getRun(orgId, runId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.ONBOARDING, {
            orgId,
            sk: (0, keys_1.workflowRunSk)(runId),
        });
        return Item ?? null;
    }
    async listRunsByWorkflow(orgId, workflowId, limit) {
        const all = await this.listRuns(orgId);
        return all
            .filter(r => r.workflowId === workflowId)
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .slice(0, limit);
    }
    async listRunsByOrg(orgId, limit) {
        const all = await this.listRuns(orgId);
        return all
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .slice(0, limit);
    }
    async update(orgId, membershipId, updates) {
        const sets = [];
        const names = {};
        const values = {};
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.ONBOARDING, { orgId, sk: (0, keys_1.onboardingRunSk)(membershipId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}
exports.WorkflowRunRepo = WorkflowRunRepo;
exports.OnboardingRunRepo = WorkflowRunRepo;
class WorkflowApprovalRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async put(approval) {
        await this.ddb.put(tables_1.Tables.ONBOARDING, {
            ...approval,
            sk: (0, keys_1.workflowApprovalSk)(approval.approvalId),
        });
    }
    async get(orgId, approvalId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.ONBOARDING, {
            orgId,
            sk: (0, keys_1.workflowApprovalSk)(approvalId),
        });
        return Item ?? null;
    }
    async listPending(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'APPROVAL#' },
        });
        const all = Items ?? [];
        return all.filter(a => a.status === 'pending');
    }
    async resolve(orgId, approvalId, status, resolvedBy, comment) {
        const sets = ['#status = :status', '#resolvedAt = :resolvedAt', '#resolvedBy = :resolvedBy'];
        const names = { '#status': 'status', '#resolvedAt': 'resolvedAt', '#resolvedBy': 'resolvedBy' };
        const values = { ':status': status, ':resolvedAt': new Date().toISOString(), ':resolvedBy': resolvedBy };
        if (comment) {
            sets.push('#comment = :comment');
            names['#comment'] = 'comment';
            values[':comment'] = comment;
        }
        await this.ddb.update(tables_1.Tables.ONBOARDING, { orgId, sk: (0, keys_1.workflowApprovalSk)(approvalId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}
exports.WorkflowApprovalRepo = WorkflowApprovalRepo;
//# sourceMappingURL=repo.js.map
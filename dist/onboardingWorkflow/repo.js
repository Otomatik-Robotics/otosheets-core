"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnboardingWorkflowRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class OnboardingWorkflowRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async get(orgId, workflowId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.ONBOARDING, {
            orgId,
            sk: (0, keys_1.onboardingWorkflowSk)(workflowId),
        });
        return Item ?? null;
    }
    async list(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'WORKFLOW#' },
        });
        return Items ?? [];
    }
    async put(orgId, workflow) {
        await this.ddb.put(tables_1.Tables.ONBOARDING, {
            orgId,
            sk: (0, keys_1.onboardingWorkflowSk)(workflow.workflowId),
            ...workflow,
        });
    }
    async delete(orgId, workflowId) {
        await this.ddb.delete(tables_1.Tables.ONBOARDING, {
            orgId,
            sk: (0, keys_1.onboardingWorkflowSk)(workflowId),
        });
    }
}
exports.OnboardingWorkflowRepo = OnboardingWorkflowRepo;
//# sourceMappingURL=repo.js.map
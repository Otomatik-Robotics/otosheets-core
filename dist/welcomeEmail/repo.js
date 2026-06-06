"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WelcomeEmailRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class WelcomeEmailRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async get(orgId, templateId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.ONBOARDING, {
            orgId,
            sk: (0, keys_1.welcomeEmailSk)(templateId),
        });
        return Item ?? null;
    }
    async list(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'WELCOME_EMAIL#' },
        });
        return Items ?? [];
    }
    async put(orgId, template) {
        await this.ddb.put(tables_1.Tables.ONBOARDING, {
            orgId,
            sk: (0, keys_1.welcomeEmailSk)(template.templateId),
            ...template,
        });
    }
    async delete(orgId, templateId) {
        await this.ddb.delete(tables_1.Tables.ONBOARDING, {
            orgId,
            sk: (0, keys_1.welcomeEmailSk)(templateId),
        });
    }
}
exports.WelcomeEmailRepo = WelcomeEmailRepo;
//# sourceMappingURL=repo.js.map
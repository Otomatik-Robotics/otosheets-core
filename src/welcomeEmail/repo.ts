import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { welcomeEmailSk } from '../keys';
import { WelcomeEmailTemplate } from './schema';

export class WelcomeEmailRepo {
    constructor(private ddb: IDdb) {}

    async get(orgId: string, templateId: string): Promise<WelcomeEmailTemplate | null> {
        const { Item } = await this.ddb.getItem(Tables.ONBOARDING, {
            orgId,
            sk: welcomeEmailSk(templateId),
        });
        return (Item as WelcomeEmailTemplate) ?? null;
    }

    async list(orgId: string): Promise<WelcomeEmailTemplate[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.ONBOARDING,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'WELCOME_EMAIL#' },
        });
        return (Items as WelcomeEmailTemplate[]) ?? [];
    }

    async put(orgId: string, template: Omit<WelcomeEmailTemplate, 'orgId' | 'sk'>): Promise<void> {
        await this.ddb.put(Tables.ONBOARDING, {
            orgId,
            sk: welcomeEmailSk(template.templateId),
            ...template,
        });
    }

    async delete(orgId: string, templateId: string): Promise<void> {
        await this.ddb.delete(Tables.ONBOARDING, {
            orgId,
            sk: welcomeEmailSk(templateId),
        });
    }
}

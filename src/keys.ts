// SK builders for composite sort keys: userId#entityId
export const sk = (userId: string, entityId: string) => `${userId}#${entityId}`;

// SK builders for specific entity patterns
export const invoicePaymentSk = (invoiceId: string, paymentId: string) => `${invoiceId}#${paymentId}`;
export const statementSk = (fy: string, statementId: string) => `${fy}#${statementId}`;
export const complianceTaskSk = (userId: string, taskId: string) => `TASK#${userId}#${taskId}`;
export const complianceSettingsSk = () => 'COMPLIANCE_SETTINGS';
export const complianceChecklistSk = (checklistId: string) => `CHECKLIST#${checklistId}`;
export const onboardingWorkflowSk = (workflowId: string) => `WORKFLOW#${workflowId}`;
export const welcomeEmailSk = (templateId: string) => `WELCOME_EMAIL#${templateId}`;
export const onboardingRunSk = (membershipId: string) => `ONBOARDING#${membershipId}`;
export const workflowRunSk = (runId: string) => `RUN#${runId}`;
export const workflowApprovalSk = (approvalId: string) => `APPROVAL#${approvalId}`;

// Scheduling / rostering SK builders
export const availabilityRuleSk = (memberId: string, ruleId: string) => `AVAIL_RULE#${memberId}#${ruleId}`;
export const timeOffSk = (memberId: string, timeOffId: string) => `TIMEOFF#${memberId}#${timeOffId}`;
export const rotationSk = (rotationId: string) => `ROTATION#${rotationId}`;
export const rosterEntrySk = (date: string, memberId: string) => `ROSTER#${date}#${memberId}`;

// Usage metering SK builder: USAGE#{metric}#{YYYY-MM} (monthly bucket per org)
export const usageSk = (metric: string, month: string) => `USAGE#${metric}#${month}`;

// GSI key builders
export const dueDateSk = (dueDate: string, invoiceId: string) => `${dueDate}#${invoiceId}`;
export const dateSk = (date: string, entityId: string) => `${date}#${entityId}`;
export const orgStageKey = (orgId: string, stage: string) => `${orgId}#${stage}`;

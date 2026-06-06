"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orgStageKey = exports.dateSk = exports.dueDateSk = exports.rosterEntrySk = exports.rotationSk = exports.timeOffSk = exports.availabilityRuleSk = exports.workflowApprovalSk = exports.workflowRunSk = exports.onboardingRunSk = exports.welcomeEmailSk = exports.onboardingWorkflowSk = exports.complianceTaskSk = exports.compliancePlaybookSk = exports.statementSk = exports.invoicePaymentSk = exports.sk = void 0;
// SK builders for composite sort keys: userId#entityId
const sk = (userId, entityId) => `${userId}#${entityId}`;
exports.sk = sk;
// SK builders for specific entity patterns
const invoicePaymentSk = (invoiceId, paymentId) => `${invoiceId}#${paymentId}`;
exports.invoicePaymentSk = invoicePaymentSk;
const statementSk = (fy, statementId) => `${fy}#${statementId}`;
exports.statementSk = statementSk;
const compliancePlaybookSk = () => 'PLAYBOOK';
exports.compliancePlaybookSk = compliancePlaybookSk;
const complianceTaskSk = (userId, taskId) => `TASK#${userId}#${taskId}`;
exports.complianceTaskSk = complianceTaskSk;
const onboardingWorkflowSk = (workflowId) => `WORKFLOW#${workflowId}`;
exports.onboardingWorkflowSk = onboardingWorkflowSk;
const welcomeEmailSk = (templateId) => `WELCOME_EMAIL#${templateId}`;
exports.welcomeEmailSk = welcomeEmailSk;
const onboardingRunSk = (membershipId) => `ONBOARDING#${membershipId}`;
exports.onboardingRunSk = onboardingRunSk;
const workflowRunSk = (runId) => `RUN#${runId}`;
exports.workflowRunSk = workflowRunSk;
const workflowApprovalSk = (approvalId) => `APPROVAL#${approvalId}`;
exports.workflowApprovalSk = workflowApprovalSk;
// Scheduling / rostering SK builders
const availabilityRuleSk = (memberId, ruleId) => `AVAIL_RULE#${memberId}#${ruleId}`;
exports.availabilityRuleSk = availabilityRuleSk;
const timeOffSk = (memberId, timeOffId) => `TIMEOFF#${memberId}#${timeOffId}`;
exports.timeOffSk = timeOffSk;
const rotationSk = (rotationId) => `ROTATION#${rotationId}`;
exports.rotationSk = rotationSk;
const rosterEntrySk = (date, memberId) => `ROSTER#${date}#${memberId}`;
exports.rosterEntrySk = rosterEntrySk;
// GSI key builders
const dueDateSk = (dueDate, invoiceId) => `${dueDate}#${invoiceId}`;
exports.dueDateSk = dueDateSk;
const dateSk = (date, entityId) => `${date}#${entityId}`;
exports.dateSk = dateSk;
const orgStageKey = (orgId, stage) => `${orgId}#${stage}`;
exports.orgStageKey = orgStageKey;
//# sourceMappingURL=keys.js.map
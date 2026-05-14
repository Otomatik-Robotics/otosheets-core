"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orgStageKey = exports.dateSk = exports.dueDateSk = exports.complianceTaskSk = exports.compliancePlaybookSk = exports.statementSk = exports.invoicePaymentSk = exports.sk = void 0;
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
// GSI key builders
const dueDateSk = (dueDate, invoiceId) => `${dueDate}#${invoiceId}`;
exports.dueDateSk = dueDateSk;
const dateSk = (date, entityId) => `${date}#${entityId}`;
exports.dateSk = dateSk;
const orgStageKey = (orgId, stage) => `${orgId}#${stage}`;
exports.orgStageKey = orgStageKey;
//# sourceMappingURL=keys.js.map
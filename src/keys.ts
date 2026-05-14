// SK builders for composite sort keys: userId#entityId
export const sk = (userId: string, entityId: string) => `${userId}#${entityId}`;

// SK builders for specific entity patterns
export const invoicePaymentSk = (invoiceId: string, paymentId: string) => `${invoiceId}#${paymentId}`;
export const statementSk = (fy: string, statementId: string) => `${fy}#${statementId}`;
export const compliancePlaybookSk = () => 'PLAYBOOK';
export const complianceTaskSk = (userId: string, taskId: string) => `TASK#${userId}#${taskId}`;

// GSI key builders
export const dueDateSk = (dueDate: string, invoiceId: string) => `${dueDate}#${invoiceId}`;
export const dateSk = (date: string, entityId: string) => `${date}#${entityId}`;
export const orgStageKey = (orgId: string, stage: string) => `${orgId}#${stage}`;

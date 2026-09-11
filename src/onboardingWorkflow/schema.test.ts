import { expect, test } from 'vitest';
import { OnboardingWorkflowStoredSchema } from './schema';

test('preserves record lookup and relative wait configuration in workflow node JSON', () => {
 const workflow = OnboardingWorkflowStoredSchema.parse({ orgId: 'org', sk: 'workflow', workflowId: 'workflow', name: 'Reminder', createdAt: '2026-09-07', updatedAt: '2026-09-07', edges: [], nodes: [
  { id: 'read', type: 'action', position: { x: 0, y: 0 }, data: { nodeType: 'READ_RECORD', label: 'Read invoice', recordType: 'invoice', recordId: '{{invoiceId}}' } },
  { id: 'wait', type: 'wait', position: { x: 0, y: 100 }, data: { nodeType: 'DELAY', label: 'Wait', delayUntil: '{{booking.start}}', delayTimezone: 'Australia/Perth', delayOffsetMinutes: -1440 } },
 ] });
 expect(workflow.nodes[0].data).toMatchObject({ recordType: 'invoice', recordId: '{{invoiceId}}' });
 expect(workflow.nodes[1].data.delayOffsetMinutes).toBe(-1440);
});

/** Extends existing execution receipts; no parallel engine or queue. */
export const workOrderAdoptionSchema = `
ALTER TABLE work_order_execution_attempts DROP CONSTRAINT IF EXISTS work_order_execution_attempts_execution_mode_check;
ALTER TABLE work_order_execution_attempts ADD CONSTRAINT work_order_execution_attempts_execution_mode_check
  CHECK (execution_mode IN ('automatic','operator_replay','human_adoption'));
ALTER TABLE work_order_execution_attempts DROP CONSTRAINT IF EXISTS work_order_execution_attempts_status_check;
ALTER TABLE work_order_execution_attempts ADD CONSTRAINT work_order_execution_attempts_status_check
  CHECK (status IN ('created','merged','skipped','failed'));
`;

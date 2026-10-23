/** Inactive candidate. Inject a persistence transport running under the admitted
 * user's JWT. Never accept actor ID, service credentials, or fake local success.
 * Snapshot + canonical facts must be committed by ONE RPC, never two requests.
 */
import { decodeIntakeRequest, decodeIntakeResponse, object, ReplacementContractError, type WireObject } from './contracts';
import { classifyIntakeText } from './intakeClassifier';
export interface IntakePersistence { record(params: { p_case_id: string; p_operation_key: string; p_source_request: WireObject; p_classification: ReturnType<typeof classifyIntakeText>; p_batch: WireObject }): Promise<unknown> }
export function prepareDurableIntake(raw: unknown, rawBatch: unknown) {
  const request = decodeIntakeRequest(raw), batch = object(rawBatch, 'BATCH_REQUIRED');
  // Preserve only the explicit legacy intake fields, no caller-supplied actor or analysis.
  if (Object.keys(request).some(k => !['source', 'client_name', 'client_email', 'customer_ref'].includes(k))) throw new ReplacementContractError('INTAKE_UNKNOWN_FIELD');
  const source = object(request.source, 'INTAKE_SOURCE_REQUIRED');
  if (Object.keys(source).some(k => !['type', 'text'].includes(k))) throw new ReplacementContractError('INTAKE_UNKNOWN_FIELD');
  if (typeof batch.case_id !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(batch.case_id) || typeof batch.batch_key !== 'string' || !/^intake:[A-Za-z0-9._:-]{8,120}$/.test(batch.batch_key) || batch.batch_key.length > 128) throw new ReplacementContractError('BATCH_IDENTITY_INVALID');
  const classification = classifyIntakeText(source.text as string);
  if (batch.workflow_key !== classification.workflow_key) throw new ReplacementContractError('BATCH_WORKFLOW_CONFLICT');
  // SQL remains authoritative for facts/access/provenance/payload limits.
  return structuredClone({ p_case_id: batch.case_id, p_operation_key: batch.batch_key, p_source_request: request, p_classification: classification, p_batch: batch });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as WireObject)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const uuid = (value: unknown) => typeof value === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
export function validateDurableIntakeReceipt(command: ReturnType<typeof prepareDurableIntake>, value: unknown) {
  const response = decodeIntakeResponse(value);
  if (response.case_id !== command.p_case_id || !uuid(response.snapshot_id) || response.operation_key !== command.p_operation_key || response.evidence_status !== 'heuristic_unverified' || typeof response.replayed !== 'boolean') throw new ReplacementContractError('DURABLE_RECEIPT_INVALID');
  for (const key of Object.keys(command.p_classification)) if (canonical(response[key]) !== canonical(command.p_classification[key as keyof typeof command.p_classification])) throw new ReplacementContractError('DURABLE_CLASSIFICATION_CONFLICT');
  const receipt = object(response.batch_receipt, 'DURABLE_BATCH_RECEIPT_REQUIRED');
  const facts = command.p_batch.facts;
  const sourceType = command.p_batch.source_type;
  if (!Array.isArray(facts) || !Array.isArray(receipt.facts) || receipt.case_id !== command.p_case_id || receipt.status !== response.status || receipt.source_type !== sourceType || receipt.confidence !== (sourceType === 'attachment_extracted' ? 0.8 : 0.7) || !['email_body', 'attachment_extracted'].includes(sourceType as string) || typeof receipt.created_case !== 'boolean' || receipt.replayed !== response.replayed || !(receipt.request_type === null || ['SEA_FCL_IMPORT', 'SEA_LCL_IMPORT', 'SEA_BREAKBULK_IMPORT', 'AIR_IMPORT', 'ROAD_IMPORT', 'MULTIMODAL_IMPORT'].includes(receipt.request_type as string)) || (receipt.created_case === true && receipt.request_type !== null)) throw new ReplacementContractError('DURABLE_RECEIPT_INVALID');
  const expected = facts.map(f => object(f, 'BATCH_FACT_INVALID').fact_key);
  const actual = receipt.facts.map(f => object(f, 'DURABLE_FACT_RECEIPT_INVALID'));
  if (new Set(expected).size !== expected.length || actual.length !== expected.length || new Set(actual.map(f => f.fact_key)).size !== actual.length || new Set(actual.map(f => f.fact_id)).size !== actual.length || actual.some(f => !expected.includes(f.fact_key) || !uuid(f.fact_id))) throw new ReplacementContractError('DURABLE_FACT_RECEIPT_INVALID');
  return response;
}

export async function createDurableIntake(persistence: IntakePersistence, raw: unknown, batch: unknown) {
  const command = prepareDurableIntake(raw, batch);
  return validateDurableIntakeReceipt(command, await persistence.record(command));
}

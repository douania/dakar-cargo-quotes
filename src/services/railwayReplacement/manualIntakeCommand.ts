/** Inactive manual form boundary. Reuses existing parsing and fact derivation;
 * the server recomputes the classification/batch. No caller actor or facts. */
import { buildIntakeFactBatch } from '../../lib/intakeFactBatch';
import { parseTextOverrides } from '../../lib/intakeTextOverrides';
import { prepareDurableIntake } from './durableIntake';
import { classifyIntakeText } from './intakeClassifier';
import { object, ReplacementContractError, type WireObject } from './contracts';
export interface ManualIntakeForm { request: WireObject; analysis: Record<string, unknown> | null; has_extracted_document: boolean }
export const MAX_MANUAL_BYTES = 262144;
export function boundedJson(value: unknown): string {
  let nodes = 0; const active = new Set<object>();
  function visit(v: unknown, depth: number): void {
    if (++nodes > 12000 || depth > 16) throw new ReplacementContractError('MANUAL_PAYLOAD_LIMIT');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v !== 'object' || !v || active.has(v) || (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype)) throw new ReplacementContractError('MANUAL_JSON_INVALID');
    active.add(v); for (const child of Object.values(v)) visit(child, depth + 1); active.delete(v);
  }
  visit(value, 0); const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).length > MAX_MANUAL_BYTES) throw new ReplacementContractError('MANUAL_PAYLOAD_LIMIT');
  return text;
}
export function prepareManualIntake(raw: unknown) {
  boundedJson(raw);
  const body = object(raw, 'MANUAL_COMMAND_REQUIRED');
  if (body.version !== 1 || Object.keys(body).some(k => !['version','case_id','request','analysis','has_extracted_document'].includes(k)) || typeof body.has_extracted_document !== 'boolean') throw new ReplacementContractError('MANUAL_COMMAND_INVALID');
  const request = object(body.request, 'INTAKE_REQUEST_REQUIRED');
  const source = object(request.source, 'INTAKE_SOURCE_REQUIRED');
  if (typeof source.text !== 'string' || !source.text.trim()) throw new ReplacementContractError('INTAKE_TEXT_REQUIRED');
  const analysis = body.analysis === null ? null : object(body.analysis, 'MANUAL_ANALYSIS_INVALID');
  if (analysis !== null && !body.has_extracted_document) throw new ReplacementContractError('MANUAL_PROVENANCE_INVALID');
  const classification = classifyIntakeText(source.text);
  const batch = buildIntakeFactBatch({ caseId: body.case_id as string, text: source.text,
    analysis, textOverrides: parseTextOverrides(source.text), hasExtractedDocument: body.has_extracted_document,
    workflowKey: classification.workflow_key });
  const command = prepareDurableIntake(request, batch);
  return { command, request, batch };
}
/** Allocate once, before the first request. Keep this exact JSON across an
 * unknown outcome. This function neither persists PII nor submits a request. */
export function newManualIntakeOperation(form: ManualIntakeForm, randomUUID: () => string) {
  const body = JSON.parse(boundedJson({ version: 1, case_id: randomUUID(), ...form }));
  prepareManualIntake(body);
  return body as { version: 1; case_id: string } & ManualIntakeForm;
}

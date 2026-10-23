/** Existing wire envelopes, not a new business or pricing model.
 * Decoders preserve all fields, reject false success, and never print request values.
 */
export type WireObject = Record<string, unknown>;
export class ReplacementContractError extends Error {
  constructor(readonly code: string) { super(`Railway replacement contract: ${code}`); this.name = 'ReplacementContractError'; }
}
export function object(value: unknown, code: string): WireObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReplacementContractError(code);
  return value as WireObject;
}
function finite(value: unknown, code: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) throw new ReplacementContractError(code);
  return value;
}
function string(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.length) throw new ReplacementContractError(code);
  return value;
}
function array(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) throw new ReplacementContractError(code);
  return value;
}
function success(value: unknown): WireObject {
  const envelope = object(value, 'ENVELOPE_REQUIRED');
  if (envelope.success !== true) throw new ReplacementContractError('SUCCESS_NOT_CONFIRMED');
  return envelope;
}
export function decodeIntakeResponse(value: unknown): WireObject {
  const result = success(value);
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(string(result.case_id, 'CASE_ID_REQUIRED'))) throw new ReplacementContractError('CASE_ID_INVALID');
  string(result.status, 'STATUS_REQUIRED');
  string(result.workflow_key, 'WORKFLOW_REQUIRED');
  const level = finite(result.complexity_level, 'COMPLEXITY_INVALID', 1);
  if (!Number.isInteger(level) || level > 4) throw new ReplacementContractError('COMPLEXITY_INVALID');
  if (finite(result.confidence, 'CONFIDENCE_INVALID') > 1) throw new ReplacementContractError('CONFIDENCE_INVALID');
  const normalized = object(result.normalized_request, 'NORMALIZED_REQUEST_REQUIRED');
  string(normalized.intent, 'NORMALIZED_INTENT_REQUIRED');
  array(normalized.modes, 'NORMALIZED_MODES_REQUIRED');
  const route = object(normalized.route, 'NORMALIZED_ROUTE_REQUIRED');
  for (const key of ['origins', 'hubs', 'destinations', 'legs']) array(route[key], 'NORMALIZED_ROUTE_INVALID');
  const cargo = object(normalized.cargo, 'NORMALIZED_CARGO_REQUIRED');
  array(cargo.items, 'NORMALIZED_ITEMS_REQUIRED');
  object(cargo.dangerous_goods, 'NORMALIZED_DG_REQUIRED');
  for (const key of ['parties', 'constraints', 'commercial']) object(normalized[key], 'NORMALIZED_SECTION_REQUIRED');
  array(result.assumptions, 'ASSUMPTIONS_REQUIRED').forEach((entry) => string(entry, 'ASSUMPTION_INVALID'));
  array(result.missing_fields, 'MISSING_FIELDS_REQUIRED').forEach((entry) => {
    const field = object(entry, 'MISSING_FIELD_INVALID');
    for (const key of ['field', 'question', 'priority']) string(field[key], 'MISSING_FIELD_INVALID');
  });
  return result;
}
export function decodeCatalogue(value: unknown): WireObject {
  const result = success(value);
  const ids = new Set<string>();
  const catalogue = array(result.trucks, 'TRUCKS_REQUIRED');
  if (!catalogue.length) throw new ReplacementContractError('TRUCKS_EMPTY');
  for (const raw of catalogue) {
    const truck = object(raw, 'TRUCK_INVALID');
    const id = string(truck.id, 'TRUCK_ID_REQUIRED');
    if (ids.has(id)) throw new ReplacementContractError('TRUCK_ID_DUPLICATED');
    ids.add(id);
    string(truck.name, 'TRUCK_NAME_REQUIRED');
    for (const key of ['length', 'width', 'height', 'max_weight']) {
      if (finite(truck[key], 'TRUCK_CAPACITY_INVALID') <= 0) throw new ReplacementContractError('TRUCK_CAPACITY_INVALID');
    }
  }
  return result;
}
export interface WirePlacement extends WireObject {
  item_id: string; x: number; y: number; z: number;
  length: number; width: number; height: number; weight: number;
}
export interface OptimizationEnvelope extends WireObject {
  result: WireObject & { placements: WirePlacement[]; items_total: number; items_placed: number };
}
export function decodeOptimization(value: unknown, tick: () => void = () => {}): OptimizationEnvelope {
  const envelope = success(value);
  const result = object(envelope.result, 'OPTIMIZATION_RESULT_REQUIRED');
  for (const key of ['items_total', 'items_placed']) {
    if (!Number.isInteger(finite(result[key], 'ITEM_COUNT_INVALID'))) throw new ReplacementContractError('ITEM_COUNT_INVALID');
  }
  if ((result.items_placed as number) > (result.items_total as number)) throw new ReplacementContractError('ITEM_COUNT_INVALID');
  for (const key of ['weight_efficiency', 'volume_efficiency']) finite(result[key], 'EFFICIENCY_INVALID');
  const truck = object(result.truck_specs, 'TRUCK_SPECS_REQUIRED');
  for (const key of ['length', 'width', 'height', 'max_weight']) if (finite(truck[key], 'TRUCK_CAPACITY_INVALID') <= 0) throw new ReplacementContractError('TRUCK_CAPACITY_INVALID');
  for (const raw of array(result.placements, 'PLACEMENTS_REQUIRED')) {
    tick(); const placement = object(raw, 'PLACEMENT_INVALID');
    string(placement.item_id, 'PLACEMENT_ID_REQUIRED');
    for (const key of ['x', 'y', 'z', 'weight']) finite(placement[key], 'PLACEMENT_INVALID');
    for (const key of ['length', 'width', 'height']) if (finite(placement[key], 'PLACEMENT_INVALID') <= 0) throw new ReplacementContractError('PLACEMENT_INVALID');
    if (typeof placement.stackable !== 'boolean') throw new ReplacementContractError('STACKABLE_REQUIRED');
  }
  return envelope as OptimizationEnvelope;
}
export function decodeFleet(value: unknown, tick: () => void = () => {}): WireObject {
  const envelope = success(value);
  const scenarios = array(envelope.scenarios, 'SCENARIOS_REQUIRED');
  if (!scenarios.length) throw new ReplacementContractError('SCENARIOS_EMPTY');
  for (const raw of scenarios) {
    tick(); const scenario = object(raw, 'SCENARIO_INVALID');
    string(scenario.id, 'SCENARIO_ID_REQUIRED');
    string(scenario.name, 'SCENARIO_NAME_REQUIRED');
    const trucks = array(scenario.trucks, 'ALLOCATION_REQUIRED');
    // Preserve explicit manual/no-solution envelopes; never turn them into a priced success.
    if (scenario.id === 'no_solution') continue;
    finite(scenario.total_cost_fcfa, 'COST_INVALID');
    if (typeof scenario.recommended !== 'boolean') throw new ReplacementContractError('RECOMMENDATION_REQUIRED');
    for (const entry of trucks) {
      tick(); const allocation = object(entry, 'ALLOCATION_INVALID');
      const spec = object(allocation.truck_specs, 'TRUCK_SPECS_REQUIRED');
      string(spec.id, 'TRUCK_ID_REQUIRED');
      array(allocation.items, 'ALLOCATION_ITEMS_REQUIRED');
      object(allocation.metrics, 'ALLOCATION_METRICS_REQUIRED');
    }
  }
  return envelope;
}

/** Manual intake always sends extracted/edited text; file parsing is a separate flow. */
export function decodeIntakeRequest(value: unknown): WireObject {
  const request = object(value, 'INTAKE_REQUEST_REQUIRED');
  const source = object(request.source, 'INTAKE_SOURCE_REQUIRED');
  if (source.type !== 'email_text' || typeof source.text !== 'string') throw new ReplacementContractError('INTAKE_TEXT_REQUIRED');
  for (const key of ['client_name', 'client_email', 'customer_ref']) if (request[key] !== undefined && typeof request[key] !== 'string') throw new ReplacementContractError('INTAKE_IDENTITY_INVALID');
  return request;
}
/** Candidate boundary: finite declared cm/kg, no heuristic conversion. */
export function decodeTruckRequest(value: unknown, action: 'optimize' | 'suggest-fleet', tick: () => void = () => {}): WireObject {
  const request = object(value, 'TRUCK_REQUEST_REQUIRED');
  const items = array(request.items, 'ITEMS_REQUIRED');
  if (!items.length) throw new ReplacementContractError('ITEMS_EMPTY');
  const ids = new Set<string>();
  for (const raw of items) {
    tick(); const item = object(raw, 'ITEM_INVALID');
    const id = string(item.id, 'ITEM_ID_REQUIRED');
    if (ids.has(id)) throw new ReplacementContractError('ITEM_ID_DUPLICATED');
    ids.add(id);
    for (const key of ['length', 'width', 'height']) if (finite(item[key], 'ITEM_DIMENSION_INVALID') <= 0) throw new ReplacementContractError('ITEM_DIMENSION_INVALID');
    finite(item.weight, 'ITEM_WEIGHT_INVALID');
    if (!Number.isInteger(finite(item.quantity, 'ITEM_QUANTITY_INVALID', 1))) throw new ReplacementContractError('ITEM_QUANTITY_INVALID');
    for (const key of ['reference', 'description']) if (item[key] !== undefined && typeof item[key] !== 'string') throw new ReplacementContractError('ITEM_METADATA_INVALID');
    if (item.fragile !== undefined && typeof item.fragile !== 'boolean') throw new ReplacementContractError('ITEM_METADATA_INVALID');
    if (item.stackable !== undefined && typeof item.stackable !== 'boolean') throw new ReplacementContractError('STACKABLE_INVALID');
  }
  if (request.algorithm !== undefined && !['simple', 'genetic'].includes(request.algorithm as string)) throw new ReplacementContractError('ALGORITHM_INVALID');
  const specs = action === 'optimize' ? [object(request.truck, 'TRUCK_REQUIRED')] : request.available_trucks === undefined ? [] : array(request.available_trucks, 'AVAILABLE_TRUCKS_INVALID').map((raw) => object(raw, 'TRUCK_INVALID'));
  for (const spec of specs) for (const key of ['length', 'width', 'height', 'max_weight']) if (finite(spec[key], 'TRUCK_CAPACITY_INVALID') <= 0) throw new ReplacementContractError('TRUCK_CAPACITY_INVALID');
  if (request.distance_km !== undefined) finite(request.distance_km, 'DISTANCE_INVALID');
  if (request.run_3d !== undefined && typeof request.run_3d !== 'boolean') throw new ReplacementContractError('RUN_3D_INVALID');
  return request;
}

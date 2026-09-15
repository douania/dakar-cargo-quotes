/** V3 adds operator-reviewed classification choices, never money, to the v2 scope. */
export interface ScenarioPadChoice {
  unit_ref: string;
  category: string | null;
  basis: string;
}
export function scenarioPadViolation(snapshot: Record<string, unknown>): string | null {
  if (snapshot.schema_version !== 3) return "schema_version";
  if (snapshot.transport_mode !== "MARITIME" || snapshot.movement_direction !== "IMPORT") return "pad_import_scope";
  if (!Array.isArray(snapshot.cargo_units) || !Array.isArray(snapshot.pad_choices) ||
    snapshot.pad_choices.length !== snapshot.cargo_units.length) return "pad_choices_count";
  const refs = new Set<string>();
  for (const raw of snapshot.pad_choices) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "pad_choice_object";
    const c = raw as Record<string, unknown>;
    if (Object.keys(c).sort().join(",") !== "basis,category,unit_ref" || typeof c.unit_ref !== "string" || refs.has(c.unit_ref) ||
      !snapshot.cargo_units.some(u => u?.unit_ref === c.unit_ref)) return "pad_choice_reference";
    if (c.category !== null && (typeof c.category !== "string" || !/^(T(0[1-9]|1[0-4])|P0[1-5])$/.test(c.category))) return "pad_category";
    if (typeof c.basis !== "string" || c.basis.length > 200 || (c.category !== null && !c.basis.trim())) return "pad_basis";
    refs.add(c.unit_ref);
  }
  return null;
}
/** PAD lives in the scenario pricing layer. The existing cargo engine receives the unchanged v2 contract. */
export function scenarioV2Shape(snapshot: Record<string, unknown>): Record<string, unknown> {
  const { pad_choices: _choices, ...base } = snapshot;
  return { ...base, schema_version: 2 };
}

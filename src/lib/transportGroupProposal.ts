import { resolveCanonicalLocalTransportContainerType } from '../../supabase/functions/_shared/local-transport-destination';
import {
  STANDARD_TRANSPORT_ESTIMATE_MAX_CARGO_KG,
  STANDARD_TRANSPORT_ESTIMATE_POLICY_REFERENCE,
} from '../../supabase/functions/_shared/local-transport-estimate';

/** Draft candidates. The provisional mode is a quotation policy, never an
 * assertion about vehicle/axle compliance or dangerous-goods classification. */
export function proposeTransportGroups(snapshot: unknown) {
  const scope = snapshot as { cargo_units?: unknown } | null;
  const groups: Record<string, unknown>[] = [];
  const excluded: string[] = [];
  for (const raw of Array.isArray(scope?.cargo_units) ? scope.cargo_units : []) {
    if (!raw || typeof raw !== 'object') continue;
    const u = raw as Record<string, unknown>;
    const ref = typeof u.unit_ref === 'string' ? u.unit_ref : '';
    const qty = typeof u.quantity === 'number' ? u.quantity : 0;
    const weight = typeof u.gross_weight_kg === 'number' && ['total', 'per_unit'].includes(String(u.weight_basis))
      ? u.gross_weight_kg / (u.weight_basis === 'total' ? qty : 1) : NaN;
    if (!ref || u.unit_kind !== 'CONTAINER' || typeof u.equipment_code !== 'string' ||
      !resolveCanonicalLocalTransportContainerType(u.equipment_code) ||
      !Number.isSafeInteger(qty) || qty <= 0 || !Number.isFinite(weight) || weight <= 0 ||
      u.dangerous_goods === true || u.un_number != null || u.imo_class != null ||
      u.temperature_control_required !== false || u.destination_ref != null) {
      excluded.push(`${ref || 'Lot'} : danger déclaré, équipement/itinéraire particulier ou données insuffisantes ; transport à confirmer.`);
      continue;
    }
    if (weight > STANDARD_TRANSPORT_ESTIMATE_MAX_CARGO_KG) {
      excluded.push(`${ref} : poids supérieur au seuil provisoire de 18 000 kg ; qualification véhicule séparée requise, sans bloquer les autres lots.`);
      continue;
    }
    groups.push({ unit_ref: ref, equipment_code: u.equipment_code, quantity: qty,
      weight_per_container_kg: weight, max_payload_kg: null, ordinary_transport: false,
      standard_estimate_only: true,
      qualification_source: STANDARD_TRANSPORT_ESTIMATE_POLICY_REFERENCE,
      unknown_danger_base_only: u.dangerous_goods == null });
  }
  return { groups, excluded };
}

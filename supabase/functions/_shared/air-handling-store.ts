import { type AirResolution } from './air-handling.ts';
import { resolveAirTariff, type AirTariffState } from './air-tariff.ts';
import { canonicalStringify } from './canonical-hash.ts';
type Client = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export async function loadAirHandling(client: Client, caseId: string): Promise<AirResolution | null> {
  const { data, error } = await client.rpc('air_tariff_read', { p_case_id: caseId });
  if (error) throw new Error('AIR_HANDLING_READ_FAILED');
  // No selection in old fixtures/runtimes is never permission to infer a profile.
  if (!data || Array.isArray(data)) return null;
  return resolveAirTariff(data as AirTariffState, new Date().toISOString().slice(0, 10));
}
export async function assertAirHandlingFresh(client: Client, caseId: string, lines: Array<{ source?: { air_handling?: AirResolution } }>): Promise<void> {
  const saved = lines.flatMap(l => l.source?.air_handling ? [l.source.air_handling] : []);
  if (!saved.length) return;
  const current = await loadAirHandling(client, caseId);
  if (saved.length !== 1 || !current || canonicalStringify(current) !== canonicalStringify(saved[0])) throw new Error('AIR_HANDLING_CONTEXT_CHANGED');
}

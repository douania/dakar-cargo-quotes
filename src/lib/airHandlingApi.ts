import { supabase } from '@/integrations/supabase/client';
import type { AirProfile, AirResolution, AirState } from '../../supabase/functions/_shared/air-handling';
import type { AirCatalogue, AirTariffState } from '../../supabase/functions/_shared/air-tariff';
export type AirProfiles = { profiles: AirProfile[]; can_edit: boolean };
export const airMoney = (n: number | null) => n === null ? 'À confirmer' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(n)} FCFA`;
export async function readAirProfiles(): Promise<AirProfiles> {
  const { data, error } = await supabase.rpc('air_handling_read', {});
  if (error || !data) throw new Error('Profils indisponibles');
  return data as unknown as AirProfiles;
}
export async function readAirCase(caseId: string): Promise<AirTariffState> {
  const { data, error } = await supabase.rpc('air_tariff_read', { p_case_id: caseId });
  if (error || !data) throw new Error('Paramétrage du dossier indisponible');
  return data as unknown as AirState;
}
export async function readAirCatalogues(): Promise<{ catalogues: AirCatalogue[]; can_edit: boolean }> {
  const { data, error } = await supabase.rpc('air_tariff_read', {});
  if (error || !data) throw new Error('Catalogue indisponible');
  const result = data as unknown as { catalogues?: AirCatalogue[]; can_edit: boolean };
  return { catalogues: result.catalogues ?? [], can_edit: result.can_edit };
}
export async function previewAir(body: Record<string, unknown>): Promise<AirResolution | null> {
  const { data, error } = await supabase.functions.invoke('preview-air-handling', { body });
  if (error || data?.ok !== true) throw new Error('Simulation indisponible');
  return data.data.resolution as AirResolution | null;
}

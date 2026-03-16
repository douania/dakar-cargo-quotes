/**
 * P6: Discreet provenance display for canonical tariff lines.
 * Shows source_table, pricing_method, and origin_layer when canonical data exists.
 */

import { Badge } from '@/components/ui/badge';

interface CanonicalBlock {
  service_key?: string | null;
  dedup_group?: string | null;
  origin_layer?: string | null;
  source_system?: string | null;
  source_table?: string | null;
  pricing_method?: string | null;
}

interface LineProvenanceBadgesProps {
  canonical?: CanonicalBlock | null;
}

const LAYER_LABELS: Record<string, string> = {
  engine_structural: 'moteur',
  package_enrichment: 'package',
  manual_override: 'manuel',
};

export function LineProvenanceBadges({ canonical }: LineProvenanceBadgesProps) {
  if (!canonical) return null;

  const { source_table, pricing_method, origin_layer } = canonical;
  if (!source_table && !pricing_method && !origin_layer) return null;

  return (
    <span className="flex items-center gap-1 mt-0.5 flex-wrap">
      {source_table && (
        <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal text-muted-foreground border-muted">
          {source_table}
        </Badge>
      )}
      {pricing_method && (
        <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal text-muted-foreground border-muted">
          {pricing_method}
        </Badge>
      )}
      {origin_layer && LAYER_LABELS[origin_layer] && (
        <span className="text-[9px] text-muted-foreground">
          {LAYER_LABELS[origin_layer]}
        </span>
      )}
    </span>
  );
}

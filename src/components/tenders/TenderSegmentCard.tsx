import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  CheckCircle2, 
  AlertCircle, 
  HelpCircle,
  Truck,
  Train,
  Ship,
  Mail,
  ExternalLink,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TenderSegment {
  id: string;
  segment_order: number;
  segment_type: string;
  origin_location: string;
  destination_location: string;
  partner_company: string | null;
  rate_per_unit: number | null;
  rate_unit: string | null;
  currency: string;
  status: string;
  inclusions: string[];
  exclusions: string[];
  additional_charges: Record<string, unknown>;
  source_email_id: string | null;
  source_learned_knowledge_id: string | null;
}

interface TenderSegmentCardProps {
  segment: TenderSegment;
  compact?: boolean;
  onMatchKnowledge?: (segment: TenderSegment) => void;
}

const segmentTypeConfig: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  inland_rca: { label: 'Transport intérieur RCA', icon: Truck, color: 'text-orange-600' },
  transit_cameroon: { label: 'Transit Cameroun', icon: Truck, color: 'text-blue-600' },
  rail_transit: { label: 'Transit ferroviaire', icon: Train, color: 'text-purple-600' },
  ocean_freight: { label: 'Fret maritime', icon: Ship, color: 'text-cyan-600' },
  unknown: { label: 'Transport', icon: Truck, color: 'text-muted-foreground' },
};

export function TenderSegmentCard({ segment, compact = false, onMatchKnowledge }: TenderSegmentCardProps) {
  const config = segmentTypeConfig[segment.segment_type] || segmentTypeConfig.unknown;
  const Icon = config.icon;
  
  const hasRate = segment.rate_per_unit && segment.rate_per_unit > 0;
  const hasSource = segment.source_email_id || segment.source_learned_knowledge_id;
  const isVerified = hasRate && hasSource;

  const getStatusBadge = () => {
    if (isVerified) {
      return (
        <Badge className="bg-green-100 text-green-800 gap-1">
          <ShieldCheck className="h-3 w-3" />
          Vérifié
        </Badge>
      );
    }
    if (hasRate && !hasSource) {
      return (
        <Badge className="bg-amber-100 text-amber-800 gap-1">
          <ShieldAlert className="h-3 w-3" />
          À confirmer
        </Badge>
      );
    }
    return (
      <Badge className="bg-muted text-muted-foreground gap-1">
        <HelpCircle className="h-3 w-3" />
        À demander
      </Badge>
    );
  };

  if (compact) {
    return (
      <div className={cn(
        "flex flex-col items-center p-3 rounded-lg border min-w-[120px]",
        isVerified ? "border-green-200 bg-green-50" : 
        hasRate ? "border-amber-200 bg-amber-50" : 
        "border-muted bg-muted/30"
      )}>
        <Icon className={cn("h-5 w-5 mb-1", config.color)} />
        <span className="text-xs font-medium text-center">{segment.origin_location}</span>
        <span className="text-xs text-muted-foreground">↓</span>
        <span className="text-xs font-medium text-center">{segment.destination_location}</span>
        {hasRate && (
          <span className="text-xs font-bold mt-1">
            {segment.rate_per_unit} {segment.currency}/{segment.rate_unit}
          </span>
        )}
      </div>
    );
  }

  return (
    <Card className={cn(
      "transition-colors",
      isVerified ? "border-green-200" : 
      hasRate ? "border-amber-200" : 
      "border-dashed"
    )}>
      <CardContent className="pt-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className={cn("p-2 rounded-lg", 
              isVerified ? "bg-green-100" : hasRate ? "bg-amber-100" : "bg-muted"
            )}>
              <Icon className={cn("h-4 w-4", config.color)} />
            </div>
            <div>
              <p className="text-sm font-medium">Segment {segment.segment_order}</p>
              <p className="text-xs text-muted-foreground">{config.label}</p>
            </div>
          </div>
          {getStatusBadge()}
        </div>

        {/* Route */}
        <div className="bg-muted/50 rounded-lg p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{segment.origin_location}</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-medium">{segment.destination_location}</span>
          </div>
        </div>

        {/* Rate */}
        {hasRate ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Tarif</span>
              <span className="text-lg font-bold">
                {segment.rate_per_unit?.toLocaleString()} {segment.currency}/{segment.rate_unit}
              </span>
            </div>
            {segment.partner_company && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Partenaire</span>
                <span className="font-medium">{segment.partner_company}</span>
              </div>
            )}
            {hasSource && (
              <div className="flex items-center gap-1 text-xs text-green-600">
                <CheckCircle2 className="h-3 w-3" />
                <span>Source: {segment.source_email_id ? 'Email' : 'Base de données'}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              <span>Tarif non disponible</span>
            </div>
            <div className="flex gap-2">
              {onMatchKnowledge && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="flex-1 gap-2"
                  onClick={() => onMatchKnowledge(segment)}
                >
                  <ExternalLink className="h-4 w-4" />
                  Rechercher tarif
                </Button>
              )}
              <Button variant="outline" size="sm" className="flex-1 gap-2">
                <Mail className="h-4 w-4" />
                Demander
              </Button>
            </div>
          </div>
        )}

        {/* Inclusions/Exclusions */}
        {(segment.inclusions?.length > 0 || segment.exclusions?.length > 0) && (
          <div className="text-xs space-y-1 border-t pt-2">
            {segment.inclusions?.length > 0 && (
              <p className="text-green-600">
                ✓ Inclus: {segment.inclusions.slice(0, 2).join(', ')}
                {segment.inclusions.length > 2 && ` +${segment.inclusions.length - 2}`}
              </p>
            )}
            {segment.exclusions?.length > 0 && (
              <p className="text-red-600">
                ✗ Exclus: {segment.exclusions.slice(0, 2).join(', ')}
                {segment.exclusions.length > 2 && ` +${segment.exclusions.length - 2}`}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

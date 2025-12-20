import { 
  AlertTriangle, 
  CheckCircle2, 
  AlertCircle, 
  Shield,
  Scale,
  Clock,
  Package,
  Ship,
  FileWarning,
  Info,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CoherenceAlert {
  type: string;
  severity: 'critical' | 'warning' | 'info';
  message_fr: string;
  message_en: string;
  ctu_reference?: string;
  details?: Record<string, unknown>;
}

interface CoherenceAudit {
  container_type?: string;
  declared_weight_kg?: number;
  declared_volume_cbm?: number;
  max_payload_kg?: number;
  max_volume_cbm?: number;
  alerts: CoherenceAlert[];
  is_compliant: boolean;
  recommendations_fr?: string[];
  recommendations_en?: string[];
}

interface IncotermAnalysis {
  detected_incoterm?: string;
  incoterm_details?: {
    code: string;
    name_fr: string;
    name_en: string;
    group_name: string;
    transfer_risk_point: string;
    seller_pays_transport: boolean;
    seller_pays_insurance: boolean;
  };
  quotation_guidance?: {
    include_freight: boolean;
    include_insurance: boolean;
    include_origin_charges: boolean;
    include_destination_charges: boolean;
    include_customs_export: boolean;
    include_customs_import: boolean;
  };
  responsibility_map?: {
    seller_responsibilities: string[];
    buyer_responsibilities: string[];
  };
  caf_calculation?: {
    method: string;
    includes_fob: boolean;
    includes_freight: boolean;
    includes_insurance: boolean;
  };
}

interface RiskIndicator {
  type: string;
  level: 'low' | 'medium' | 'high';
  message_fr: string;
  message_en: string;
  recommended_action?: string;
}

interface RiskAnalysis {
  time_risk?: RiskIndicator;
  nature_risk?: RiskIndicator;
  volume_risk?: RiskIndicator;
}

interface VigilancePoint {
  category: string;
  message_fr: string;
  message_en: string;
  priority: 'high' | 'medium' | 'low';
}

interface V5Analysis {
  coherence_audit?: CoherenceAudit;
  incoterm_analysis?: IncotermAnalysis;
  risk_analysis?: RiskAnalysis;
  vigilance_points?: VigilancePoint[];
}

interface Props {
  v5Analysis?: V5Analysis;
}

export function V5AnalysisDisplay({ v5Analysis }: Props) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!v5Analysis) {
    return null;
  }

  const { coherence_audit, incoterm_analysis, risk_analysis, vigilance_points } = v5Analysis;

  const hasAlerts = coherence_audit?.alerts && coherence_audit.alerts.length > 0;
  const hasVigilancePoints = vigilance_points && vigilance_points.length > 0;
  const hasIncotermAnalysis = incoterm_analysis?.detected_incoterm;
  const hasRiskAnalysis = risk_analysis && Object.keys(risk_analysis).length > 0;

  if (!hasAlerts && !hasVigilancePoints && !hasIncotermAnalysis && !hasRiskAnalysis) {
    return null;
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'border-destructive bg-destructive/10 text-destructive';
      case 'warning':
        return 'border-amber-500 bg-amber-500/10 text-amber-600';
      case 'info':
        return 'border-blue-500 bg-blue-500/10 text-blue-600';
      default:
        return 'border-muted bg-muted/50';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="h-5 w-5" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5" />;
      case 'info':
        return <Info className="h-5 w-5" />;
      default:
        return <Info className="h-5 w-5" />;
    }
  };

  const getRiskLevelColor = (level: string) => {
    switch (level) {
      case 'high':
        return 'bg-destructive/20 text-destructive border-destructive';
      case 'medium':
        return 'bg-amber-500/20 text-amber-600 border-amber-500';
      case 'low':
        return 'bg-green-500/20 text-green-600 border-green-500';
      default:
        return 'bg-muted';
    }
  };

  return (
    <Card className="border-primary/30 bg-gradient-card shadow-glow">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="h-5 w-5 text-primary" />
            Analyse V5 - Points de vigilance
          </CardTitle>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          {/* CTU Code Coherence Alerts */}
          {hasAlerts && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Package className="h-4 w-4 text-amber-500" />
                Alertes CTU Code ({coherence_audit.alerts.length})
              </div>
              <div className="space-y-2">
                {coherence_audit.alerts.map((alert, index) => (
                  <div 
                    key={index}
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border",
                      getSeverityColor(alert.severity)
                    )}
                  >
                    {getSeverityIcon(alert.severity)}
                    <div className="flex-1">
                      <p className="font-medium">{alert.message_fr}</p>
                      {alert.ctu_reference && (
                        <p className="text-xs mt-1 opacity-80">
                          Réf. CTU: {alert.ctu_reference}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {alert.type}
                    </Badge>
                  </div>
                ))}
              </div>
              {coherence_audit.recommendations_fr && coherence_audit.recommendations_fr.length > 0 && (
                <div className="pl-4 mt-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Recommandations:</p>
                  <ul className="text-sm list-disc list-inside space-y-1 text-muted-foreground">
                    {coherence_audit.recommendations_fr.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {hasAlerts && (hasIncotermAnalysis || hasRiskAnalysis) && <Separator />}

          {/* Incoterm Analysis */}
          {hasIncotermAnalysis && incoterm_analysis.incoterm_details && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Scale className="h-4 w-4 text-blue-500" />
                Analyse Incoterm: {incoterm_analysis.detected_incoterm}
              </div>
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{incoterm_analysis.incoterm_details.name_fr}</p>
                    <p className="text-xs text-muted-foreground">
                      Groupe: {incoterm_analysis.incoterm_details.group_name} | 
                      Transfert risque: {incoterm_analysis.incoterm_details.transfer_risk_point}
                    </p>
                  </div>
                  <Badge className="bg-blue-500/20 text-blue-500 border-blue-500">
                    {incoterm_analysis.incoterm_details.code}
                  </Badge>
                </div>

                {incoterm_analysis.quotation_guidance && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      {incoterm_analysis.quotation_guidance.include_freight ? (
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                      ) : (
                        <AlertCircle className="h-3 w-3 text-muted-foreground" />
                      )}
                      Fret maritime
                    </div>
                    <div className="flex items-center gap-1">
                      {incoterm_analysis.quotation_guidance.include_insurance ? (
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                      ) : (
                        <AlertCircle className="h-3 w-3 text-muted-foreground" />
                      )}
                      Assurance
                    </div>
                    <div className="flex items-center gap-1">
                      {incoterm_analysis.quotation_guidance.include_origin_charges ? (
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                      ) : (
                        <AlertCircle className="h-3 w-3 text-muted-foreground" />
                      )}
                      Frais origine
                    </div>
                    <div className="flex items-center gap-1">
                      {incoterm_analysis.quotation_guidance.include_destination_charges ? (
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                      ) : (
                        <AlertCircle className="h-3 w-3 text-muted-foreground" />
                      )}
                      Frais destination
                    </div>
                  </div>
                )}

                {incoterm_analysis.responsibility_map && (
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="font-medium text-green-500 mb-1">Vendeur</p>
                      <ul className="space-y-0.5 text-muted-foreground">
                        {incoterm_analysis.responsibility_map.seller_responsibilities.slice(0, 3).map((r, i) => (
                          <li key={i}>• {r}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="font-medium text-amber-500 mb-1">Acheteur</p>
                      <ul className="space-y-0.5 text-muted-foreground">
                        {incoterm_analysis.responsibility_map.buyer_responsibilities.slice(0, 3).map((r, i) => (
                          <li key={i}>• {r}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Risk Analysis */}
          {hasRiskAnalysis && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock className="h-4 w-4 text-amber-500" />
                Analyse des risques
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {risk_analysis.time_risk && (
                  <div className={cn(
                    "p-3 rounded-lg border",
                    getRiskLevelColor(risk_analysis.time_risk.level)
                  )}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">Risque temporel</span>
                      <Badge variant="outline" className="text-xs">
                        {risk_analysis.time_risk.level}
                      </Badge>
                    </div>
                    <p className="text-sm">{risk_analysis.time_risk.message_fr}</p>
                  </div>
                )}
                {risk_analysis.nature_risk && (
                  <div className={cn(
                    "p-3 rounded-lg border",
                    getRiskLevelColor(risk_analysis.nature_risk.level)
                  )}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">Risque marchandise</span>
                      <Badge variant="outline" className="text-xs">
                        {risk_analysis.nature_risk.level}
                      </Badge>
                    </div>
                    <p className="text-sm">{risk_analysis.nature_risk.message_fr}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Vigilance Points */}
          {hasVigilancePoints && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileWarning className="h-4 w-4 text-primary" />
                Points de vigilance ({vigilance_points.length})
              </div>
              <div className="space-y-2">
                {vigilance_points.map((point, index) => (
                  <div 
                    key={index}
                    className={cn(
                      "flex items-start gap-2 p-2 rounded-lg border",
                      point.priority === 'high' 
                        ? 'border-destructive/50 bg-destructive/5' 
                        : point.priority === 'medium'
                        ? 'border-amber-500/50 bg-amber-500/5'
                        : 'border-muted bg-muted/30'
                    )}
                  >
                    <Badge 
                      variant="outline" 
                      className={cn(
                        "text-xs shrink-0",
                        point.priority === 'high' ? 'border-destructive text-destructive' :
                        point.priority === 'medium' ? 'border-amber-500 text-amber-500' :
                        'border-muted-foreground'
                      )}
                    >
                      {point.category}
                    </Badge>
                    <p className="text-sm">{point.message_fr}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Compliant Status */}
          {coherence_audit && (
            <div className={cn(
              "flex items-center gap-2 p-3 rounded-lg",
              coherence_audit.is_compliant 
                ? "bg-green-500/10 border border-green-500/30 text-green-600"
                : "bg-amber-500/10 border border-amber-500/30 text-amber-600"
            )}>
              {coherence_audit.is_compliant ? (
                <>
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">Opération conforme aux normes CTU</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5" />
                  <span className="font-medium">Vérification recommandée avant validation</span>
                </>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

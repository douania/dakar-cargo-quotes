import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertCircle, CheckCircle2, AlertTriangle, Zap } from 'lucide-react';
import type { ComplexityAssessment } from '@/hooks/useComplexityAssessment';

interface ComplexityBadgeProps {
  assessment: ComplexityAssessment;
  showTooltip?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const ICONS = {
  green: CheckCircle2,
  yellow: Zap,
  orange: AlertTriangle,
  red: AlertCircle,
};

const VARIANT_STYLES = {
  green: 'bg-green-100 text-green-800 border-green-300 hover:bg-green-200',
  yellow: 'bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-200',
  orange: 'bg-orange-100 text-orange-800 border-orange-300 hover:bg-orange-200',
  red: 'bg-red-100 text-red-800 border-red-300 hover:bg-red-200',
};

const SIZE_STYLES = {
  sm: 'text-xs px-1.5 py-0.5',
  md: 'text-xs px-2 py-0.5',
  lg: 'text-sm px-2.5 py-1',
};

export function ComplexityBadge({ assessment, showTooltip = true, size = 'md' }: ComplexityBadgeProps) {
  const Icon = ICONS[assessment.color];
  const iconSize = size === 'sm' ? 'h-3 w-3' : size === 'lg' ? 'h-4 w-4' : 'h-3.5 w-3.5';
  
  const badge = (
    <Badge 
      variant="outline" 
      className={`${VARIANT_STYLES[assessment.color]} ${SIZE_STYLES[size]} gap-1 font-medium border`}
    >
      <Icon className={iconSize} />
      <span>{assessment.label}</span>
    </Badge>
  );
  
  if (!showTooltip) {
    return badge;
  }
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {badge}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="space-y-1.5">
          <p className="font-semibold">Niveau {assessment.level}: {assessment.label}</p>
          
          {assessment.reasons.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Détection:</p>
              <ul className="text-xs list-disc list-inside">
                {assessment.reasons.slice(0, 3).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          
          {assessment.warnings.length > 0 && (
            <div className="text-amber-600">
              <p className="text-xs font-medium mb-0.5">⚠️ Vigilance:</p>
              <ul className="text-xs list-disc list-inside">
                {assessment.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          
          {assessment.suggestedActions.length > 0 && (
            <div className="text-blue-600">
              <p className="text-xs font-medium mb-0.5">💡 Suggestion:</p>
              <p className="text-xs">{assessment.suggestedActions[0]}</p>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

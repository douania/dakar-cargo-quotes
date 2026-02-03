/**
 * Phase 8.3 — Tag d'usage du thread
 * 
 * Affiche le rôle du thread :
 * - 📘 Apprentissage : comprendre des patterns passés
 * - ⚙️ Cotation active : répondre à une demande en cours
 * - 🗂️ Historique : archivé, non contractuel
 * 
 * Classification déterministe, pas d'IA
 */

import { BookOpen, Cog, Archive } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ThreadUsageType } from '@/hooks/useQuoteCaseData';

interface Props {
  usageType: ThreadUsageType;
  size?: 'sm' | 'default';
}

const USAGE_CONFIG: Record<NonNullable<ThreadUsageType>, {
  icon: React.ReactNode;
  label: string;
  description: string;
  className: string;
}> = {
  apprentissage: {
    icon: <BookOpen className="h-3 w-3" />,
    label: 'Apprentissage',
    description: 'Thread analysé pour comprendre les patterns passés',
    className: 'bg-blue-100 text-blue-800 hover:bg-blue-200',
  },
  cotation_active: {
    icon: <Cog className="h-3 w-3" />,
    label: 'Cotation active',
    description: 'Demande de cotation en cours de traitement',
    className: 'bg-green-100 text-green-800 hover:bg-green-200',
  },
  historique: {
    icon: <Archive className="h-3 w-3" />,
    label: 'Historique',
    description: 'Dossier terminé, archivé pour référence',
    className: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
  },
};

export function ThreadUsageTag({ usageType, size = 'default' }: Props) {
  if (!usageType) {
    return null;
  }

  const config = USAGE_CONFIG[usageType];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="secondary" 
            className={`${config.className} cursor-help ${size === 'sm' ? 'text-xs px-1.5 py-0' : ''}`}
          >
            {config.icon}
            <span className="ml-1">{config.label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{config.description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

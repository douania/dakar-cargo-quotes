import { Badge } from '@/components/ui/badge';
import { Building, User, Users, Truck, MapPin, HelpCircle } from 'lucide-react';

export interface ParticipantWithRole {
  email: string;
  role: 'client' | 'partner' | 'supplier' | 'agent' | 'internal' | 'prospect' | 'unknown';
  company: string;
  isKnown?: boolean;
}

interface ThreadParticipantsProps {
  participants: ParticipantWithRole[] | string[];
  compact?: boolean;
}

const roleConfig: Record<string, { 
  label: string; 
  icon: typeof User; 
  className: string;
}> = {
  client: {
    label: 'Client',
    icon: Building,
    className: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800'
  },
  partner: {
    label: 'Partenaire',
    icon: Users,
    className: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800'
  },
  supplier: {
    label: 'Fournisseur',
    icon: Truck,
    className: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800'
  },
  agent: {
    label: 'Agent',
    icon: MapPin,
    className: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800'
  },
  internal: {
    label: 'Interne',
    icon: User,
    className: 'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
  },
  prospect: {
    label: 'Prospect',
    icon: HelpCircle,
    className: 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
  },
  unknown: {
    label: 'Inconnu',
    icon: HelpCircle,
    className: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-500 dark:border-slate-800'
  }
};

function extractEmailUsername(email: string): string {
  const match = email.match(/^([^@]+)@/);
  return match ? match[1] : email;
}

function normalizeParticipant(participant: ParticipantWithRole | string): ParticipantWithRole {
  if (typeof participant === 'string') {
    return {
      email: participant,
      role: 'unknown',
      company: participant.split('@')[1]?.split('.')[0]?.toUpperCase() || 'UNKNOWN'
    };
  }
  return participant;
}

export function ThreadParticipants({ participants, compact = false }: ThreadParticipantsProps) {
  if (!participants || participants.length === 0) {
    return <span className="text-xs text-muted-foreground">Aucun participant</span>;
  }

  const normalizedParticipants = participants.map(normalizeParticipant);

  // Group by role for summary
  const roleCounts = normalizedParticipants.reduce((acc, p) => {
    acc[p.role] = (acc[p.role] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (compact) {
    // Compact mode: just show role badges with counts
    return (
      <div className="flex flex-wrap gap-1">
        {Object.entries(roleCounts).map(([role, count]) => {
          const config = roleConfig[role] || roleConfig.unknown;
          const Icon = config.icon;
          return (
            <Badge key={role} variant="outline" className={`text-xs ${config.className}`}>
              <Icon className="h-2.5 w-2.5 mr-0.5" />
              {count}
            </Badge>
          );
        })}
      </div>
    );
  }

  // Full mode: show all participants with details
  return (
    <div className="space-y-1.5">
      {normalizedParticipants.map((participant, index) => {
        const config = roleConfig[participant.role] || roleConfig.unknown;
        const Icon = config.icon;
        
        return (
          <div key={`${participant.email}-${index}`} className="flex items-center gap-2 text-sm">
            <Badge variant="outline" className={`text-xs px-1.5 py-0 h-5 ${config.className}`}>
              <Icon className="h-3 w-3 mr-1" />
              {config.label}
            </Badge>
            <span className="font-medium">{participant.company}</span>
            <span className="text-muted-foreground text-xs">
              ({extractEmailUsername(participant.email)})
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ThreadParticipantsSummary({ participants }: { participants: ParticipantWithRole[] | string[] }) {
  if (!participants || participants.length === 0) {
    return null;
  }

  const normalizedParticipants = participants.map(normalizeParticipant);
  
  // Filter out internal for the summary
  const externalParticipants = normalizedParticipants.filter(p => p.role !== 'internal');
  
  // Get key roles
  const client = normalizedParticipants.find(p => p.role === 'client');
  const partner = normalizedParticipants.find(p => p.role === 'partner');
  const suppliersCount = normalizedParticipants.filter(p => p.role === 'supplier').length;
  const agentsCount = normalizedParticipants.filter(p => p.role === 'agent').length;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {client && (
        <span className="flex items-center gap-1">
          <Badge variant="outline" className={`text-xs ${roleConfig.client.className}`}>
            <Building className="h-3 w-3 mr-1" />
            {client.company}
          </Badge>
        </span>
      )}
      {partner && (
        <span className="flex items-center gap-1">
          <Badge variant="outline" className={`text-xs ${roleConfig.partner.className}`}>
            <Users className="h-3 w-3 mr-1" />
            {partner.company}
          </Badge>
        </span>
      )}
      {suppliersCount > 0 && (
        <Badge variant="outline" className={`text-xs ${roleConfig.supplier.className}`}>
          <Truck className="h-3 w-3 mr-1" />
          {suppliersCount} fournisseur{suppliersCount > 1 ? 's' : ''}
        </Badge>
      )}
      {agentsCount > 0 && (
        <Badge variant="outline" className={`text-xs ${roleConfig.agent.className}`}>
          <MapPin className="h-3 w-3 mr-1" />
          {agentsCount} agent{agentsCount > 1 ? 's' : ''}
        </Badge>
      )}
    </div>
  );
}

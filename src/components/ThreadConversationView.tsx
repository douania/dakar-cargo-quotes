import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Paperclip, Star, User, Building, Briefcase } from 'lucide-react';
import { useThreadEmails, getSenderType, type SenderType } from '@/hooks/useThreadEmails';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface ThreadConversationViewProps {
  threadId: string;
  clientEmail?: string | null;
  partnerEmail?: string | null;
}

const senderConfig: Record<SenderType, { 
  label: string; 
  icon: typeof User;
  bgColor: string;
  borderColor: string;
  textColor: string;
  avatarBg: string;
}> = {
  internal: {
    label: 'SODATRA',
    icon: Briefcase,
    bgColor: 'bg-muted/50',
    borderColor: 'border-l-muted-foreground',
    textColor: 'text-muted-foreground',
    avatarBg: 'bg-muted',
  },
  client: {
    label: 'Client',
    icon: User,
    bgColor: 'bg-success/10',
    borderColor: 'border-l-success',
    textColor: 'text-success',
    avatarBg: 'bg-success/20',
  },
  partner: {
    label: 'Partenaire',
    icon: Building,
    bgColor: 'bg-warning/10',
    borderColor: 'border-l-warning',
    textColor: 'text-warning',
    avatarBg: 'bg-warning/20',
  },
  unknown: {
    label: 'Externe',
    icon: User,
    bgColor: 'bg-card',
    borderColor: 'border-l-border',
    textColor: 'text-foreground',
    avatarBg: 'bg-accent',
  },
};

function getInitials(email: string): string {
  const name = email.split('@')[0];
  const parts = name.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  try {
    return format(new Date(dateStr), "d MMM yyyy 'à' HH:mm", { locale: fr });
  } catch {
    return dateStr;
  }
}

export function ThreadConversationView({ threadId, clientEmail, partnerEmail }: ThreadConversationViewProps) {
  const { data: thread, isLoading } = useThreadEmails(threadId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="w-10 h-10 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-1/4 mb-2" />
              <Skeleton className="h-20 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!thread || thread.emails.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Aucun message dans ce fil
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
        <span>{thread.emails.length} message{thread.emails.length > 1 ? 's' : ''}</span>
        {thread.client_email && (
          <Badge variant="outline" className="gap-1">
            <User className="h-3 w-3" />
            {thread.client_email}
          </Badge>
        )}
        {thread.partner_email && (
          <Badge variant="outline" className="gap-1">
            <Building className="h-3 w-3" />
            {thread.partner_email}
          </Badge>
        )}
      </div>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />

        <div className="space-y-4">
          {thread.emails.map((email, index) => {
            const senderType = getSenderType(
              email.from_address, 
              clientEmail || thread.client_email, 
              partnerEmail || thread.partner_email
            );
            const config = senderConfig[senderType];
            const Icon = config.icon;
            const isInternal = senderType === 'internal';

            return (
              <div 
                key={email.id} 
                className={cn(
                  "relative flex gap-3",
                  isInternal ? "flex-row-reverse" : ""
                )}
              >
                {/* Avatar */}
                <Avatar className={cn("w-10 h-10 shrink-0 z-10", config.avatarBg)}>
                  <AvatarFallback className={cn("text-xs font-medium", config.textColor)}>
                    {getInitials(email.from_address)}
                  </AvatarFallback>
                </Avatar>

                {/* Message Card */}
                <Card className={cn(
                  "flex-1 max-w-[85%] border-l-4",
                  config.bgColor,
                  config.borderColor
                )}>
                  <CardContent className="p-4">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={cn("gap-1 text-xs", config.textColor)}>
                          <Icon className="h-3 w-3" />
                          {config.label}
                        </Badge>
                        <span className="text-sm font-medium truncate max-w-[200px]">
                          {email.from_address}
                        </span>
                        {email.is_quotation_request && (
                          <Star className="h-4 w-4 text-warning fill-warning" />
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(email.sent_at)}
                      </span>
                    </div>

                    {/* Subject if different from thread */}
                    {email.subject && email.subject !== thread.subject_normalized && (
                      <div className="text-sm font-medium text-muted-foreground mb-2">
                        Re: {email.subject}
                      </div>
                    )}

                    {/* Body */}
                    <div className="text-sm whitespace-pre-wrap line-clamp-6">
                      {email.body_text?.slice(0, 500) || '(Aucun contenu texte)'}
                      {(email.body_text?.length || 0) > 500 && '...'}
                    </div>

                    {/* Attachments indicator */}
                    {email.attachmentCount && email.attachmentCount > 0 && (
                      <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
                        <Paperclip className="h-3 w-3" />
                        {email.attachmentCount} pièce{email.attachmentCount > 1 ? 's' : ''} jointe{email.attachmentCount > 1 ? 's' : ''}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

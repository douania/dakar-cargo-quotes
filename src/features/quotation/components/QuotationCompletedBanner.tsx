/**
 * UI COMPONENT — FROZEN (Phase 4B)
 * - Ne pas modifier sans ouvrir une nouvelle phase
 */

import React from 'react';
import { CheckCircle, Loader2, GraduationCap, FileSpreadsheet, Paperclip } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { QuotationOffer } from '@/features/quotation/types';

interface QuotationCompletedBannerProps {
  quotationOffers: QuotationOffer[];
  isLearning: boolean;
  onLearnFromQuotation: () => void;
  formatDate: (dateStr: string | null) => string;
  getOfferTypeIcon: (type: 'container' | 'breakbulk' | 'combined') => React.ReactNode;
  getOfferTypeLabel: (type: 'container' | 'breakbulk' | 'combined') => string;
}

export function QuotationCompletedBanner({
  quotationOffers,
  isLearning,
  onLearnFromQuotation,
  formatDate,
  getOfferTypeIcon,
  getOfferTypeLabel,
}: QuotationCompletedBannerProps) {
  return (
    <Card className="border-green-500/30 bg-green-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2 text-green-600">
            <CheckCircle className="h-5 w-5" />
            COTATION RÉALISÉE
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={onLearnFromQuotation}
            disabled={isLearning}
            className="border-green-500/30 text-green-600 hover:bg-green-500/10"
          >
            {isLearning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <GraduationCap className="h-4 w-4 mr-2" />
            )}
            Apprendre de cette cotation
          </Button>
        </div>
        <CardDescription>
          {quotationOffers.length} offre(s) envoyée(s) dans ce fil de discussion
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {quotationOffers.map((offer, index) => (
          <div 
            key={offer.email.id}
            className="p-4 rounded-lg border border-green-500/20 bg-background"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  {getOfferTypeIcon(offer.type)}
                  {getOfferTypeLabel(offer.type)}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Email {index + 1}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {formatDate(offer.sentAt)}
              </span>
            </div>
            
            <div className="mb-3">
              <p className="text-sm">
                <span className="text-muted-foreground">Par: </span>
                <span className="font-medium">{offer.senderName}</span>
                <span className="text-muted-foreground"> ({offer.senderEmail})</span>
              </p>
            </div>
            
            {offer.detectedContent.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-muted-foreground mb-1">Contenu détecté:</p>
                <div className="flex flex-wrap gap-1">
                  {offer.detectedContent.map((content, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {content}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            
            {offer.attachments.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Pièces jointes:</p>
                <div className="flex flex-wrap gap-2">
                  {offer.attachments.map(att => (
                    <Badge 
                      key={att.id} 
                      variant="outline" 
                      className={cn(
                        "text-xs gap-1",
                        att.filename.endsWith('.xlsx') || att.filename.endsWith('.xls') 
                          ? "border-green-500/30 text-green-600"
                          : att.filename.endsWith('.pdf')
                          ? "border-red-500/30 text-red-600"
                          : ""
                      )}
                    >
                      {att.filename.endsWith('.xlsx') || att.filename.endsWith('.xls') ? (
                        <FileSpreadsheet className="h-3 w-3" />
                      ) : (
                        <Paperclip className="h-3 w-3" />
                      )}
                      {att.filename.length > 30 ? att.filename.substring(0, 30) + '...' : att.filename}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

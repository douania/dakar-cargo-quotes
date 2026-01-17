import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Mail, 
  FileText, 
  Users, 
  DollarSign, 
  CheckCircle, 
  XCircle, 
  FileSpreadsheet,
  LayoutTemplate,
  Package,
  AlertCircle
} from 'lucide-react';

export interface AttachmentResult {
  id: string;
  filename: string;
  type: string;
  linesExtracted?: number;
  sheetsFound?: number;
  success: boolean;
  error?: string;
}

export interface ImportSummary {
  // Email stats
  emailsImported: number;
  emailsExisting: number;
  attachmentsProcessed: number;
  
  // Knowledge from import-thread
  knowledgeStored: number;
  quotationDetected: boolean;
  quotationAmount: string | null;
  
  // Attachment analysis results
  attachmentResults: AttachmentResult[];
  
  // Derived stats
  totalTariffLines: number;
  contactsDiscovered: number;
  templatesIdentified: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: ImportSummary | null;
}

export function ImportSummaryDialog({ open, onOpenChange, summary }: Props) {
  if (!summary) return null;

  const successfulAttachments = summary.attachmentResults.filter(r => r.success);
  const failedAttachments = summary.attachmentResults.filter(r => !r.success);

  const getTypeIcon = (type: string) => {
    switch (type?.toLowerCase()) {
      case 'packing_list':
        return <Package className="h-3 w-3 text-amber-500" />;
      case 'quotation':
      case 'tariff':
        return <DollarSign className="h-3 w-3 text-green-500" />;
      case 'invoice':
        return <FileText className="h-3 w-3 text-blue-500" />;
      case 'signature':
      case 'contact':
        return <Users className="h-3 w-3 text-purple-500" />;
      default:
        return <FileText className="h-3 w-3 text-muted-foreground" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type?.toLowerCase()) {
      case 'packing_list':
        return 'Packing List';
      case 'quotation':
        return 'Cotation';
      case 'tariff':
        return 'Tarif';
      case 'invoice':
        return 'Facture';
      case 'bill_of_lading':
        return 'BL';
      case 'signature':
        return 'Signature';
      case 'contact':
        return 'Contact';
      case 'generic':
        return 'Document';
      default:
        return type || 'Inconnu';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Récapitulatif de l'import
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Email Stats */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
              <Mail className="h-4 w-4" />
              EMAILS
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-green-50 dark:bg-green-950 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-600">{summary.emailsImported}</div>
                <div className="text-xs text-muted-foreground">nouveaux</div>
              </div>
              <div className="bg-muted rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{summary.emailsExisting}</div>
                <div className="text-xs text-muted-foreground">existants</div>
              </div>
              <div className="bg-blue-50 dark:bg-blue-950 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-blue-600">{summary.emailsImported + summary.emailsExisting}</div>
                <div className="text-xs text-muted-foreground">total</div>
              </div>
            </div>
          </div>

          {/* Knowledge Stats */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              CONNAISSANCES EXTRAITES
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-amber-50 dark:bg-amber-950 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-amber-600">{summary.totalTariffLines}</div>
                <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  <DollarSign className="h-3 w-3" /> tarifs
                </div>
              </div>
              <div className="bg-purple-50 dark:bg-purple-950 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-purple-600">{summary.contactsDiscovered}</div>
                <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  <Users className="h-3 w-3" /> contacts
                </div>
              </div>
              <div className="bg-indigo-50 dark:bg-indigo-950 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-indigo-600">{summary.templatesIdentified}</div>
                <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  <LayoutTemplate className="h-3 w-3" /> templates
                </div>
              </div>
            </div>
            
            {summary.quotationDetected && (
              <div className="mt-2 p-2 bg-green-50 dark:bg-green-950 rounded-lg flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-sm">
                  Cotation détectée
                  {summary.quotationAmount && (
                    <span className="font-medium ml-1">: {summary.quotationAmount}</span>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* Attachments Results */}
          {summary.attachmentResults.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                PIÈCES JOINTES ANALYSÉES ({successfulAttachments.length}/{summary.attachmentResults.length})
              </h4>
              <ScrollArea className="max-h-40">
                <div className="space-y-1">
                  {summary.attachmentResults.map((result) => (
                    <div 
                      key={result.id}
                      className={`flex items-center gap-2 p-2 rounded text-sm ${
                        result.success 
                          ? 'bg-muted/50' 
                          : 'bg-red-50 dark:bg-red-950'
                      }`}
                    >
                      {result.success ? (
                        <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                      )}
                      <span className="truncate flex-1" title={result.filename}>
                        {result.filename}
                      </span>
                      {result.success ? (
                        <>
                          <Badge variant="outline" className="text-xs shrink-0 flex items-center gap-1">
                            {getTypeIcon(result.type)}
                            {getTypeLabel(result.type)}
                          </Badge>
                          {result.linesExtracted !== undefined && result.linesExtracted > 0 && (
                            <Badge variant="secondary" className="text-xs shrink-0">
                              {result.linesExtracted} ligne{result.linesExtracted > 1 ? 's' : ''}
                            </Badge>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-red-500 shrink-0">
                          {result.error || 'Erreur'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
              
              {failedAttachments.length > 0 && (
                <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-950 rounded-lg flex items-center gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  <span>{failedAttachments.length} fichier(s) en erreur</span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

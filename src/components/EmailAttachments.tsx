import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { 
  FileText, FileSpreadsheet, File, Download, Eye, 
  CheckCircle, Loader2, Image as ImageIcon, Sparkles, AlertTriangle, RefreshCw
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AnalysisResultsDisplay } from '@/components/AnalysisResultsDisplay';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Attachment {
  id: string;
  email_id: string;
  filename: string;
  content_type: string | null;
  size: number | null;
  storage_path: string | null;
  extracted_text: string | null;
  extracted_data: any;
  is_analyzed: boolean;
}

interface EmailAttachmentsProps {
  emailId: string;
}

type AttachmentStatus = 'analyzed' | 'pending' | 'skipped';

interface AttachmentStatusInfo {
  status: AttachmentStatus;
  reason: string | null;
}

const getAttachmentStatus = (attachment: Attachment): AttachmentStatusInfo => {
  // Check if extracted_text contains a skip reason (in brackets)
  if (attachment.extracted_text?.startsWith('[')) {
    const match = attachment.extracted_text.match(/\[(.*?)\]/);
    const reason = match ? match[1] : 'Non traité';
    return { status: 'skipped', reason };
  }
  if (attachment.is_analyzed) {
    return { status: 'analyzed', reason: null };
  }
  return { status: 'pending', reason: null };
};

export function EmailAttachments({ emailId }: EmailAttachmentsProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [forceDownloading, setForceDownloading] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    loadAttachments();
  }, [emailId]);

  const loadAttachments = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('email_attachments')
        .select('*')
        .eq('email_id', emailId);

      if (error) throw error;
      setAttachments(data || []);
    } catch (error) {
      console.error('Error loading attachments:', error);
    }
    setLoading(false);
  };

  const analyzeAttachment = async (attachmentId: string) => {
    setAnalyzing(attachmentId);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-attachments', {
        body: { attachmentId }
      });

      if (error) throw error;

      if (data.success) {
        toast.success('Pièce jointe analysée');
        loadAttachments();
      } else {
        toast.error(data.error || 'Erreur d\'analyse');
      }
    } catch (error) {
      console.error('Analyze error:', error);
      toast.error('Erreur lors de l\'analyse');
    }
    setAnalyzing(null);
  };

  const analyzeAllAttachments = async () => {
    setAnalyzing('all');
    try {
      const analyzable = attachments.filter(a => {
        const status = getAttachmentStatus(a);
        return status.status === 'pending';
      });
      
      if (analyzable.length === 0) {
        toast.info('Aucune pièce jointe à analyser');
        setAnalyzing(null);
        return;
      }

      const { data, error } = await supabase.functions.invoke('analyze-attachments', {
        body: {}
      });

      if (error) throw error;

      if (data.success) {
        toast.success(`${data.analyzed} pièce(s) jointe(s) analysée(s)`);
        loadAttachments();
      } else {
        toast.error(data.error || 'Erreur d\'analyse');
      }
    } catch (error) {
      console.error('Analyze error:', error);
      toast.error('Erreur lors de l\'analyse');
    }
    setAnalyzing(null);
  };

  const forceDownloadAttachment = async (attachmentId: string) => {
    setForceDownloading(attachmentId);
    try {
      const { data, error } = await supabase.functions.invoke('force-download-attachment', {
        body: { attachmentId }
      });

      if (error) throw error;

      if (data.success) {
        toast.success('Pièce jointe téléchargée avec succès');
        loadAttachments();
      } else {
        toast.error(data.error || 'Échec du téléchargement');
      }
    } catch (error) {
      console.error('Force download error:', error);
      toast.error('Erreur lors du téléchargement forcé');
    }
    setForceDownloading(null);
  };

  const getFileIcon = (contentType: string | null, filename: string) => {
    if (contentType?.includes('pdf') || filename.endsWith('.pdf')) {
      return <FileText className="h-5 w-5 text-red-500" />;
    }
    if (contentType?.includes('spreadsheet') || contentType?.includes('excel') || 
        filename.endsWith('.xlsx') || filename.endsWith('.xls') || filename.endsWith('.csv')) {
      return <FileSpreadsheet className="h-5 w-5 text-green-500" />;
    }
    if (contentType?.includes('image') || /\.(jpg|jpeg|png|gif|webp)$/i.test(filename)) {
      return <ImageIcon className="h-5 w-5 text-blue-500" />;
    }
    return <File className="h-5 w-5 text-muted-foreground" />;
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const downloadAttachment = async (attachment: Attachment) => {
    if (!attachment.storage_path) return;

    try {
      const { data, error } = await supabase.storage
        .from('documents')
        .download(attachment.storage_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
    }
  };

  const openPreview = async (attachment: Attachment) => {
    setPreviewAttachment(attachment);
    
    if (attachment.storage_path) {
      const { data } = await supabase.storage
        .from('documents')
        .getPublicUrl(attachment.storage_path);
      setPreviewUrl(data.publicUrl);
    }
  };

  const closePreview = () => {
    setPreviewAttachment(null);
    setPreviewUrl(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (attachments.length === 0) {
    return null;
  }

  // Count attachments by status
  const statusCounts = attachments.reduce(
    (acc, attachment) => {
      const { status } = getAttachmentStatus(attachment);
      acc[status]++;
      return acc;
    },
    { analyzed: 0, pending: 0, skipped: 0 }
  );

  const renderStatusBadge = (attachment: Attachment) => {
    const { status, reason } = getAttachmentStatus(attachment);

    if (status === 'analyzed') {
      return (
        <Badge variant="outline" className="text-xs py-0 px-1">
          <CheckCircle className="h-3 w-3 mr-1 text-green-500" />
          Analysé
        </Badge>
      );
    }

    if (status === 'skipped') {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-xs py-0 px-1 border-amber-500/50 bg-amber-500/10">
                <AlertTriangle className="h-3 w-3 mr-1 text-amber-500" />
                Non traité
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-sm">{reason}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return null;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Pièces jointes ({attachments.length})
          </h4>
          {statusCounts.skipped > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-xs py-0 px-1.5 border-amber-500/50 bg-amber-500/10 text-amber-600">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {statusCounts.skipped} non traité{statusCounts.skipped > 1 ? 's' : ''}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-sm">Fichiers trop volumineux ou images inline ignorées</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        {statusCounts.pending > 0 && (
          <Button 
            size="sm" 
            variant="outline"
            onClick={analyzeAllAttachments}
            disabled={analyzing === 'all'}
          >
            {analyzing === 'all' ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            Analyser ({statusCounts.pending})
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {attachments.map((attachment) => {
          const { status, reason } = getAttachmentStatus(attachment);
          const isSkipped = status === 'skipped';
          
          return (
            <Card 
              key={attachment.id} 
              className={`bg-muted/50 ${isSkipped ? 'border-amber-500/30' : ''}`}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    {getFileIcon(attachment.content_type, attachment.filename)}
                    {isSkipped && (
                      <AlertTriangle className="h-3 w-3 text-amber-500 absolute -bottom-1 -right-1" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" title={attachment.filename}>
                      {attachment.filename}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <span>{formatFileSize(attachment.size)}</span>
                      {renderStatusBadge(attachment)}
                    </div>
                    {isSkipped && reason && (
                      <p className="text-xs text-amber-600 mt-1 truncate" title={reason}>
                        {reason}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {status === 'pending' && (
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-8 w-8"
                        onClick={() => analyzeAttachment(attachment.id)}
                        disabled={analyzing === attachment.id}
                        title="Analyser"
                      >
                        {analyzing === attachment.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    {isSkipped && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              className="h-8 w-8 text-amber-600 hover:text-amber-700 hover:bg-amber-100"
                              onClick={() => forceDownloadAttachment(attachment.id)}
                              disabled={forceDownloading === attachment.id}
                              title="Forcer le téléchargement"
                            >
                              {forceDownloading === attachment.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p className="text-sm">Forcer le téléchargement depuis le serveur</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      className="h-8 w-8"
                      onClick={() => openPreview(attachment)}
                      title="Aperçu"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              className="h-8 w-8"
                              onClick={() => downloadAttachment(attachment)}
                              title="Télécharger"
                              disabled={!attachment.storage_path}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {!attachment.storage_path && (
                          <TooltipContent side="bottom">
                            <p className="text-sm">Fichier non disponible (non téléchargé)</p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Preview Dialog */}
      <Dialog open={!!previewAttachment} onOpenChange={closePreview}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          {previewAttachment && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {getFileIcon(previewAttachment.content_type, previewAttachment.filename)}
                  {previewAttachment.filename}
                  {getAttachmentStatus(previewAttachment).status === 'skipped' && (
                    <Badge variant="outline" className="ml-2 text-xs border-amber-500/50 bg-amber-500/10">
                      <AlertTriangle className="h-3 w-3 mr-1 text-amber-500" />
                      Non traité
                    </Badge>
                  )}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* Skipped reason alert with force download option */}
                {getAttachmentStatus(previewAttachment).status === 'skipped' && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                    <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-amber-600">Pièce jointe non traitée</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {getAttachmentStatus(previewAttachment).reason}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                        onClick={() => forceDownloadAttachment(previewAttachment.id)}
                        disabled={forceDownloading === previewAttachment.id}
                      >
                        {forceDownloading === previewAttachment.id ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        Forcer le téléchargement
                      </Button>
                    </div>
                  </div>
                )}

                {/* Image preview */}
                {previewUrl && previewAttachment.content_type?.includes('image') && (
                  <div className="flex justify-center">
                    <img 
                      src={previewUrl} 
                      alt={previewAttachment.filename}
                      className="max-h-[500px] object-contain rounded-lg"
                    />
                  </div>
                )}

                {/* PDF preview */}
                {previewUrl && previewAttachment.content_type?.includes('pdf') && (
                  <div className="border rounded-lg overflow-hidden">
                    <iframe 
                      src={previewUrl}
                      className="w-full h-[500px]"
                      title={previewAttachment.filename}
                    />
                  </div>
                )}

                {/* Extracted text - only show if not a skip message */}
                {previewAttachment.extracted_text && 
                 !previewAttachment.extracted_text.startsWith('[') && (
                  <div className="space-y-2">
                    <h5 className="text-sm font-medium">Contenu extrait</h5>
                    <pre className="whitespace-pre-wrap bg-muted p-4 rounded-lg text-sm max-h-[300px] overflow-y-auto">
                      {previewAttachment.extracted_text}
                    </pre>
                  </div>
                )}

                {/* Extracted data */}
                {previewAttachment.extracted_data && (
                  <AnalysisResultsDisplay 
                    extractedData={previewAttachment.extracted_data}
                    attachmentId={previewAttachment.id}
                  />
                )}

                {/* Download button */}
                <div className="flex justify-end">
                  <Button 
                    onClick={() => downloadAttachment(previewAttachment)}
                    disabled={!previewAttachment.storage_path}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Télécharger
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

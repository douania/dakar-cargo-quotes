import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { 
  FileText, FileSpreadsheet, File, Download, Eye, 
  CheckCircle, Loader2, Image as ImageIcon, Sparkles
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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

export function EmailAttachments({ emailId }: EmailAttachmentsProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
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
      const unanalyzed = attachments.filter(a => !a.is_analyzed);
      if (unanalyzed.length === 0) {
        toast.info('Toutes les pièces jointes sont déjà analysées');
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

  const unanalyzedCount = attachments.filter(a => !a.is_analyzed).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-muted-foreground">
          Pièces jointes ({attachments.length})
        </h4>
        {unanalyzedCount > 0 && (
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
            Analyser tout ({unanalyzedCount})
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {attachments.map((attachment) => (
          <Card key={attachment.id} className="bg-muted/50">
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                {getFileIcon(attachment.content_type, attachment.filename)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" title={attachment.filename}>
                    {attachment.filename}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatFileSize(attachment.size)}</span>
                    {attachment.is_analyzed && (
                      <Badge variant="outline" className="text-xs py-0 px-1">
                        <CheckCircle className="h-3 w-3 mr-1 text-green-500" />
                        Analysé
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  {!attachment.is_analyzed && (
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
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    className="h-8 w-8"
                    onClick={() => openPreview(attachment)}
                    title="Aperçu"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
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
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
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
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
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

                {/* Extracted text */}
                {previewAttachment.extracted_text && (
                  <div className="space-y-2">
                    <h5 className="text-sm font-medium">Contenu extrait</h5>
                    <pre className="whitespace-pre-wrap bg-muted p-4 rounded-lg text-sm max-h-[300px] overflow-y-auto">
                      {previewAttachment.extracted_text}
                    </pre>
                  </div>
                )}

                {/* Extracted data */}
                {previewAttachment.extracted_data && (
                  <div className="space-y-2">
                    <h5 className="text-sm font-medium">Données extraites</h5>
                    <pre className="whitespace-pre-wrap bg-muted p-4 rounded-lg text-sm max-h-[300px] overflow-y-auto">
                      {JSON.stringify(previewAttachment.extracted_data, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Download button */}
                <div className="flex justify-end">
                  <Button onClick={() => downloadAttachment(previewAttachment)}>
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

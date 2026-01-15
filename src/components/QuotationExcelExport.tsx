import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { 
  FileSpreadsheet, 
  Download, 
  Loader2, 
  ExternalLink,
  CheckCircle2
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface QuotationLine {
  category: string;
  service: string;
  unit: string;
  rate: number;
  quantity: number;
  amount: number;
  source: string;
  notes?: string;
}

interface ContainerScenario {
  name: string;
  containerType: string;
  weight?: number;
  lines: QuotationLine[];
  total: number;
}

interface QuotationExcelExportProps {
  client: string;
  destination: string;
  origin?: string;
  incoterm?: string;
  containerType?: string;
  currency?: string;
  lines: QuotationLine[];
  marginPercent?: number;
  validityDays?: number;
  scenarios?: ContainerScenario[];
  reference?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function QuotationExcelExport({
  client,
  destination,
  origin,
  incoterm,
  containerType,
  currency = 'EUR',
  lines,
  marginPercent,
  validityDays = 30,
  scenarios,
  reference,
  variant = 'default',
  size = 'default'
}: QuotationExcelExportProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const handleExport = async () => {
    if (!lines || lines.length === 0) {
      toast.error('Aucune ligne de cotation à exporter');
      return;
    }

    setIsGenerating(true);
    setDownloadUrl(null);

    try {
      const { data, error } = await supabase.functions.invoke('generate-excel-quotation', {
        body: {
          client,
          destination,
          origin,
          incoterm,
          containerType,
          currency,
          lines,
          marginPercent,
          validityDays,
          scenarios,
          reference,
        }
      });

      if (error) throw error;

      if (data?.success && data?.file?.url) {
        setDownloadUrl(data.file.url);
        toast.success(`Fichier Excel généré: ${data.file.filename}`, {
          description: `${data.file.tabs.length} onglets créés`,
          action: {
            label: 'Télécharger',
            onClick: () => window.open(data.file.url, '_blank'),
          }
        });
      } else {
        throw new Error(data?.error || 'Échec de la génération');
      }
    } catch (error) {
      console.error('Excel export error:', error);
      toast.error('Erreur lors de la génération Excel', {
        description: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    } finally {
      setIsGenerating(false);
    }
  };

  if (downloadUrl) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size={size}
          onClick={() => window.open(downloadUrl, '_blank')}
          className="gap-2 text-green-700 border-green-300 hover:bg-green-50"
        >
          <CheckCircle2 className="h-4 w-4" />
          Télécharger Excel
          <ExternalLink className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setDownloadUrl(null);
            handleExport();
          }}
          title="Regénérer"
        >
          <FileSpreadsheet className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleExport}
      disabled={isGenerating || lines.length === 0}
      className="gap-2"
    >
      {isGenerating ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Génération...
        </>
      ) : (
        <>
          <FileSpreadsheet className="h-4 w-4" />
          Export Excel Pro
        </>
      )}
    </Button>
  );
}

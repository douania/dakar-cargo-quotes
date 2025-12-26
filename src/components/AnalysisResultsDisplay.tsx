import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Download, FileSpreadsheet, Loader2, CheckCircle } from 'lucide-react';

interface TariffLine {
  service?: string;
  container_type?: string;
  unit?: string;
  amount?: number;
  currency?: string;
  amount_eur?: number;
  notes?: string;
  destination?: string;
  origin?: string;
  [key: string]: any;
}

interface ExtractedData {
  document_type?: string;
  carrier?: string;
  sheetNames?: string[];
  tariff_lines?: TariffLine[];
  summary?: string;
  [key: string]: any;
}

interface AnalysisResultsDisplayProps {
  extractedData: ExtractedData;
  attachmentId?: string;
}

const getAnalysisType = (data: ExtractedData): string => {
  if (data?.tariff_lines && Array.isArray(data.tariff_lines)) return 'transport_tariffs';
  if (data?.document_type === 'quotation') return 'quotation';
  if (data?.document_type) return 'document';
  return 'generic';
};

const formatAmount = (amount: number | undefined, currency?: string): string => {
  if (amount === undefined || amount === null) return '-';
  return `${amount.toLocaleString('fr-FR')} ${currency || 'XOF'}`;
};

export function AnalysisResultsDisplay({ extractedData, attachmentId }: AnalysisResultsDisplayProps) {
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);

  const analysisType = getAnalysisType(extractedData);

  const handleImportTariffs = async () => {
    if (!extractedData.tariff_lines || extractedData.tariff_lines.length === 0) {
      toast.error('Aucun tarif à importer');
      return;
    }

    setImporting(true);
    try {
      const tariffsToInsert = extractedData.tariff_lines
        .filter(line => line.amount && line.amount > 0)
        .map(line => ({
          origin: line.origin || 'Dakar Port',
          destination: line.destination || line.service || 'Non spécifié',
          container_type: line.container_type || '20DV',
          rate_amount: line.amount,
          rate_currency: line.currency || 'XOF',
          cargo_category: extractedData.carrier || 'Dry',
          provider: extractedData.carrier || 'Unknown',
          notes: line.notes || `Importé depuis analyse - ${new Date().toLocaleDateString('fr-FR')}`,
          source_document: attachmentId || 'email_attachment',
          is_active: true,
        }));

      if (tariffsToInsert.length === 0) {
        toast.error('Aucun tarif valide à importer');
        setImporting(false);
        return;
      }

      const { error } = await supabase
        .from('local_transport_rates')
        .insert(tariffsToInsert);

      if (error) throw error;

      toast.success(`${tariffsToInsert.length} tarif(s) importé(s) avec succès`);
      setImported(true);
    } catch (error) {
      console.error('Import error:', error);
      toast.error('Erreur lors de l\'importation');
    }
    setImporting(false);
  };

  // Transport tariffs view
  if (analysisType === 'transport_tariffs') {
    const tariffLines = extractedData.tariff_lines || [];
    const sheetNames = extractedData.sheetNames || ['Tous'];
    
    // Group tariffs by sheet/category if available
    const tariffsBySheet = tariffLines.reduce((acc, line) => {
      const sheet = (line as any).sheet || 'Tous';
      if (!acc[sheet]) acc[sheet] = [];
      acc[sheet].push(line);
      return acc;
    }, {} as Record<string, TariffLine[]>);

    const sheets = Object.keys(tariffsBySheet).length > 0 
      ? Object.keys(tariffsBySheet) 
      : sheetNames;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-green-500" />
            <h5 className="text-sm font-medium">Tarifs de transport extraits</h5>
            <Badge variant="outline" className="text-xs">
              {tariffLines.length} ligne(s)
            </Badge>
          </div>
          <Button
            size="sm"
            onClick={handleImportTariffs}
            disabled={importing || imported || tariffLines.length === 0}
          >
            {importing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : imported ? (
              <CheckCircle className="h-4 w-4 mr-2 text-green-500" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {imported ? 'Importé' : 'Importer ces tarifs'}
          </Button>
        </div>

        {extractedData.carrier && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Transporteur:</span>
            <Badge>{extractedData.carrier}</Badge>
          </div>
        )}

        {sheets.length > 1 ? (
          <Tabs defaultValue={sheets[0]} className="w-full">
            <TabsList className="w-full flex-wrap h-auto gap-1">
              {sheets.map(sheet => (
                <TabsTrigger key={sheet} value={sheet} className="text-xs">
                  {sheet}
                  {tariffsBySheet[sheet] && (
                    <Badge variant="secondary" className="ml-1 text-xs px-1">
                      {tariffsBySheet[sheet].length}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {sheets.map(sheet => (
              <TabsContent key={sheet} value={sheet}>
                <TariffTable tariffs={tariffsBySheet[sheet] || tariffLines} />
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <TariffTable tariffs={tariffLines} />
        )}

        {extractedData.summary && (
          <div className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
            <strong>Résumé:</strong> {extractedData.summary}
          </div>
        )}
      </div>
    );
  }

  // Generic JSON view for other types
  return (
    <div className="space-y-2">
      <h5 className="text-sm font-medium">Données extraites</h5>
      {extractedData.document_type && (
        <Badge variant="outline" className="mb-2">{extractedData.document_type}</Badge>
      )}
      <pre className="whitespace-pre-wrap bg-muted p-4 rounded-lg text-sm max-h-[300px] overflow-y-auto">
        {JSON.stringify(extractedData, null, 2)}
      </pre>
    </div>
  );
}

function TariffTable({ tariffs }: { tariffs: TariffLine[] }) {
  if (tariffs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        Aucun tarif dans cette catégorie
      </p>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service / Destination</TableHead>
            <TableHead>Type Conteneur</TableHead>
            <TableHead>Unité</TableHead>
            <TableHead className="text-right">Montant</TableHead>
            <TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tariffs.map((line, idx) => (
            <TableRow key={idx}>
              <TableCell className="font-medium">
                {line.destination || line.service || '-'}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {line.container_type || '-'}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {line.unit || '-'}
              </TableCell>
              <TableCell className="text-right font-mono">
                {formatAmount(line.amount, line.currency)}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                {line.notes || '-'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

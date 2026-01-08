import { useState, useCallback } from 'react';
import { Upload, FileSpreadsheet, X, AlertCircle, CheckCircle2, Brain, FlaskConical } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { parsePackingListWithAI, AIExtractionResult } from '@/services/truckLoadingService';
import { PackingItem, DimensionUnit } from '@/types/truckLoading';
import { toast } from 'sonner';

interface PackingListUploaderProps {
  onUploadComplete: (
    items: PackingItem[], 
    detectedUnit?: DimensionUnit, 
    warnings?: string[]
  ) => void;
}

export function PackingListUploader({ onUploadComplete }: PackingListUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AIExtractionResult | null>(null);

  const validateFile = (file: File): boolean => {
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    const validExtensions = ['.xlsx', '.xls'];
    
    const hasValidType = validTypes.includes(file.type);
    const hasValidExtension = validExtensions.some(ext => 
      file.name.toLowerCase().endsWith(ext)
    );

    if (!hasValidType && !hasValidExtension) {
      setError('Format invalide. Veuillez utiliser un fichier Excel (.xlsx ou .xls)');
      return false;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Le fichier est trop volumineux (max 10 MB)');
      return false;
    }

    return true;
  };

  const handleFile = async (file: File) => {
    setError(null);
    setAiResult(null);
    
    if (!validateFile(file)) {
      return;
    }

    setSelectedFile(file);
    setIsUploading(true);
    setUploadProgress(0);

    // Progress simulation for AI processing (takes longer)
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => Math.min(prev + 5, 85));
    }, 500);

    try {
      const result = await parsePackingListWithAI(file);
      clearInterval(progressInterval);
      setUploadProgress(100);
      setAiResult(result);
      
      if (result.items.length === 0) {
        setError('Aucun article valide trouvé dans le fichier');
        setIsUploading(false);
        return;
      }
      
      // Calculate total weight for verification
      const totalWeight = result.items.reduce((sum, item) => sum + item.weight, 0);
      const heavyItems = result.items.filter(item => item.weight > 10000);
      
      toast.success(
        `${result.items.length} articles extraits par IA`,
        { 
          description: `Poids total: ${(totalWeight / 1000).toFixed(1)} tonnes${heavyItems.length > 0 ? ` (${heavyItems.length} colis lourds)` : ''}`
        }
      );
      
      setTimeout(() => {
        onUploadComplete(
          result.items, 
          result.detected_dimension_unit as DimensionUnit,
          result.warnings
        );
      }, 1000);
    } catch (err) {
      clearInterval(progressInterval);
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'analyse IA';
      setError(message);
      toast.error(message);
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  const resetUpload = () => {
    setSelectedFile(null);
    setIsUploading(false);
    setUploadProgress(0);
    setError(null);
    setAiResult(null);
  };

  const loadDemoFile = async () => {
    setError(null);
    setAiResult(null);
    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Fetch the demo file from public folder
      const response = await fetch('/data/test-packing-list-61t-trafo.xlsx');
      if (!response.ok) {
        throw new Error('Impossible de charger le fichier de démo');
      }
      
      const blob = await response.blob();
      const demoFile = new File([blob], 'test-packing-list-61t-trafo.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      
      setSelectedFile(demoFile);
      
      // Progress simulation for AI processing
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 5, 85));
      }, 500);

      const result = await parsePackingListWithAI(demoFile);
      clearInterval(progressInterval);
      setUploadProgress(100);
      setAiResult(result);
      
      if (result.items.length === 0) {
        setError('Aucun article valide trouvé dans le fichier');
        setIsUploading(false);
        return;
      }
      
      const totalWeight = result.items.reduce((sum, item) => sum + item.weight, 0);
      const heavyItems = result.items.filter(item => item.weight > 10000);
      
      toast.success(
        `Fichier démo: ${result.items.length} articles extraits`,
        { 
          description: `Poids total: ${(totalWeight / 1000).toFixed(1)} tonnes${heavyItems.length > 0 ? ` (${heavyItems.length} colis lourds)` : ''}`
        }
      );
      
      setTimeout(() => {
        onUploadComplete(
          result.items,
          result.detected_dimension_unit as DimensionUnit,
          result.warnings
        );
      }, 1000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement du fichier démo';
      setError(message);
      toast.error(message);
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="space-y-4">
      <Card
        className={`border-2 border-dashed transition-all duration-200 ${
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <CardContent className="flex flex-col items-center justify-center py-12">
          {!selectedFile ? (
            <>
              <div className="rounded-full bg-primary/10 p-4 mb-4">
                <Upload className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Glissez votre fichier Excel ici
              </h3>
              <p className="text-muted-foreground text-sm mb-4">
                ou cliquez pour sélectionner un fichier
              </p>
              <div className="flex gap-3">
                <label>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleInputChange}
                    className="hidden"
                  />
                  <Button variant="outline" asChild>
                    <span className="cursor-pointer">
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                      Parcourir
                    </span>
                  </Button>
                </label>
                <Button 
                  variant="secondary" 
                  onClick={loadDemoFile}
                  disabled={isUploading}
                >
                  <FlaskConical className="h-4 w-4 mr-2" />
                  Charger fichier de démo
                </Button>
              </div>
              <div className="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
                <Brain className="h-4 w-4" />
                <span>Extraction intelligente par IA - Supporte tous les formats de packing list</span>
              </div>
            </>
          ) : (
            <div className="w-full max-w-md space-y-4">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="h-10 w-10 text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{selectedFile.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                {!isUploading && (
                  <Button variant="ghost" size="icon" onClick={resetUpload}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              
              {isUploading && (
                <div className="space-y-2">
                  <Progress value={uploadProgress} className="h-2" />
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Brain className="h-4 w-4 animate-pulse" />
                    <span>
                      {uploadProgress < 100 ? 'Analyse IA en cours...' : 'Terminé !'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Warnings Display */}
      {aiResult && aiResult.warnings.length > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Avertissements de l'IA</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside mt-2 space-y-1">
              {aiResult.warnings.map((warning, index) => (
                <li key={index} className="text-sm">{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* AI Success Info */}
      {aiResult && aiResult.items.length > 0 && !error && (
        <Alert className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-700 dark:text-green-400">
            Extraction réussie
          </AlertTitle>
          <AlertDescription className="text-green-600 dark:text-green-300">
            {aiResult.total_items} articles extraits depuis {aiResult.sheets_analyzed.length} onglet(s).
            Type détecté: {aiResult.document_type === 'packing_list' ? 'Packing List' : aiResult.document_type}
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

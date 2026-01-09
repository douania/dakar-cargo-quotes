import { useState, useCallback } from 'react';
import { Upload, FileSpreadsheet, X, AlertCircle, CheckCircle2, Brain, FlaskConical, Beaker } from 'lucide-react';
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

// Packing list simple pour test rapide (20 articles, ~52T, 2-3 camions)
const SIMPLE_TEST_PACKING_LIST: PackingItem[] = [
  { id: 'test_1', description: 'Palette machines', length: 120, width: 100, height: 150, weight: 2500, quantity: 3, stackable: true },
  { id: 'test_2', description: 'Caisse électrique', length: 200, width: 150, height: 180, weight: 1800, quantity: 5, stackable: true },
  { id: 'test_3', description: 'Bobine câbles', length: 150, width: 150, height: 120, weight: 3200, quantity: 2, stackable: true },
  { id: 'test_4', description: 'Container pièces', length: 240, width: 120, height: 140, weight: 4500, quantity: 4, stackable: true },
  { id: 'test_5', description: 'Armoire électrique', length: 80, width: 60, height: 200, weight: 800, quantity: 6, stackable: false },
];

// Packing list complexe pour test de charge (100 articles, ~233T, 8-10 camions)
const COMPLEX_TEST_PACKING_LIST: PackingItem[] = [
  // 8x Groupes électrogènes (4.5T chacun = 36T)
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `gen_${i+1}`, description: 'Groupe électrogène industriel',
    length: 300, width: 150, height: 200, weight: 4500, quantity: 1, stackable: false
  })),
  // 10x Compresseurs (3.8T chacun = 38T)
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `comp_${i+1}`, description: 'Compresseur haute pression',
    length: 250, width: 180, height: 180, weight: 3800, quantity: 1, stackable: false
  })),
  // 12x Pompes (2.2T chacune = 26.4T)
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `pump_${i+1}`, description: 'Pompe centrifuge',
    length: 180, width: 120, height: 140, weight: 2200, quantity: 1, stackable: true
  })),
  // 15x Armoires électriques (1.5T chacune = 22.5T)
  ...Array.from({ length: 15 }, (_, i) => ({
    id: `cabinet_${i+1}`, description: 'Armoire électrique HT',
    length: 120, width: 80, height: 220, weight: 1500, quantity: 1, stackable: false
  })),
  // 8x Bobines câbles (2.8T chacune = 22.4T)
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `cable_${i+1}`, description: 'Bobine câbles 500m',
    length: 150, width: 150, height: 100, weight: 2800, quantity: 1, stackable: true
  })),
  // 10x Palettes vannes (1.8T chacune = 18T)
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `valve_${i+1}`, description: 'Palette vannes industrielles',
    length: 120, width: 100, height: 80, weight: 1800, quantity: 1, stackable: true
  })),
  // 20x Caisses instrumentation (450kg chacune = 9T)
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `instr_${i+1}`, description: 'Caisse instrumentation',
    length: 100, width: 80, height: 60, weight: 450, quantity: 1, stackable: true
  })),
  // 6x Structures métalliques (3.5T chacune = 21T)
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `struct_${i+1}`, description: 'Structure métallique',
    length: 600, width: 120, height: 80, weight: 3500, quantity: 1, stackable: false
  })),
  // 5x Échangeurs thermiques (5.5T chacun = 27.5T)
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `exchanger_${i+1}`, description: 'Échangeur thermique',
    length: 400, width: 200, height: 200, weight: 5500, quantity: 1, stackable: false
  })),
  // 6x Cuves inox (2T chacune = 12T)
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `tank_${i+1}`, description: 'Cuve inox 5000L',
    length: 250, width: 200, height: 250, weight: 2000, quantity: 1, stackable: false
  })),
];
// Total: 100 articles, ~233 tonnes

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

  // Test simple : 20 articles, ~52T, 2-3 camions
  const handleSimpleTest = () => {
    const totalWeight = SIMPLE_TEST_PACKING_LIST.reduce(
      (sum, item) => sum + item.weight * item.quantity, 0
    );
    const totalItems = SIMPLE_TEST_PACKING_LIST.reduce(
      (sum, item) => sum + item.quantity, 0
    );
    
    console.log('[Test Simple] Articles:', totalItems, '| Poids total:', (totalWeight / 1000).toFixed(1), 'T');
    console.time('[Test Simple] Durée totale');
    
    onUploadComplete(
      SIMPLE_TEST_PACKING_LIST, 
      'cm', 
      ['Données de test - 20 articles standards (~52T)']
    );
    
    toast.info(`Test simple chargé`, {
      description: `${totalItems} articles, ${(totalWeight / 1000).toFixed(1)} tonnes (2-3 camions attendus)`
    });
  };

  // Test complexe : 100 articles, ~233T, 8-10 camions
  const handleComplexTest = () => {
    const totalWeight = COMPLEX_TEST_PACKING_LIST.reduce(
      (sum, item) => sum + item.weight * item.quantity, 0
    );
    const totalItems = COMPLEX_TEST_PACKING_LIST.length;
    
    console.log('[Test Complexe] Articles:', totalItems, '| Poids total:', (totalWeight / 1000).toFixed(1), 'T');
    console.time('[Test Complexe] Durée totale');
    
    onUploadComplete(
      COMPLEX_TEST_PACKING_LIST, 
      'cm', 
      ['Données de test - 100 articles industriels (~233T)']
    );
    
    toast.info(`Test flotte complexe chargé`, {
      description: `${totalItems} articles, ${(totalWeight / 1000).toFixed(1)} tonnes (8-10 camions attendus)`
    });
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
              <div className="flex gap-3 flex-wrap justify-center">
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
                  Démo transformateur 61T
                </Button>
              </div>
              
              {/* Boutons de test développeur */}
              {import.meta.env.DEV && (
                <div className="flex gap-2 mt-4 pt-4 border-t border-dashed border-muted-foreground/25 w-full justify-center">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleSimpleTest}
                    className="text-xs"
                  >
                    <Beaker className="h-3 w-3 mr-1" />
                    Test simple (20 art.)
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleComplexTest}
                    className="text-xs"
                  >
                    <Beaker className="h-3 w-3 mr-1" />
                    Test flotte (100 art.)
                  </Button>
                </div>
              )}
              
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

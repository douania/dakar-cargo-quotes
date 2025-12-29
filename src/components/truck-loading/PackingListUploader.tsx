import { useState, useCallback } from 'react';
import { Upload, FileSpreadsheet, X, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { uploadPackingList } from '@/services/truckLoadingService';
import { PackingItem } from '@/types/truckLoading';
import { toast } from 'sonner';

interface PackingListUploaderProps {
  onUploadComplete: (items: PackingItem[]) => void;
}

export function PackingListUploader({ onUploadComplete }: PackingListUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    
    if (!validateFile(file)) {
      return;
    }

    setSelectedFile(file);
    setIsUploading(true);
    setUploadProgress(0);

    // Simulate progress
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => Math.min(prev + 10, 90));
    }, 200);

    try {
      const items = await uploadPackingList(file);
      clearInterval(progressInterval);
      setUploadProgress(100);
      
      toast.success(`${items.length} articles importés avec succès`);
      
      setTimeout(() => {
        onUploadComplete(items);
      }, 500);
    } catch (err) {
      clearInterval(progressInterval);
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'upload';
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
              <p className="text-xs text-muted-foreground mt-4">
                Formats acceptés : .xlsx, .xls (max 10 MB)
              </p>
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
                  <p className="text-sm text-center text-muted-foreground">
                    {uploadProgress < 100 ? 'Analyse en cours...' : 'Terminé !'}
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

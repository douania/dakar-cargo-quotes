import { useState, useMemo } from 'react';
import { Check, AlertTriangle, Package, Scale, Box } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { PackingItem } from '@/types/truckLoading';

interface DataValidationTableProps {
  items: PackingItem[];
  onItemsChange: (items: PackingItem[]) => void;
  onValidate: () => void;
}

interface ValidationError {
  itemId: string;
  field: string;
  message: string;
}

export function DataValidationTable({
  items,
  onItemsChange,
  onValidate,
}: DataValidationTableProps) {
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);

  const validateItem = (item: PackingItem): ValidationError[] => {
    const errors: ValidationError[] = [];
    
    if (!item.description?.trim()) {
      errors.push({ itemId: item.id, field: 'description', message: 'Description requise' });
    }
    if (item.length <= 0) {
      errors.push({ itemId: item.id, field: 'length', message: 'Longueur invalide' });
    }
    if (item.width <= 0) {
      errors.push({ itemId: item.id, field: 'width', message: 'Largeur invalide' });
    }
    if (item.height <= 0) {
      errors.push({ itemId: item.id, field: 'height', message: 'Hauteur invalide' });
    }
    if (item.weight <= 0) {
      errors.push({ itemId: item.id, field: 'weight', message: 'Poids invalide' });
    }
    if (item.quantity <= 0) {
      errors.push({ itemId: item.id, field: 'quantity', message: 'Quantité invalide' });
    }
    
    return errors;
  };

  const allErrors = useMemo(() => {
    return items.flatMap(item => validateItem(item));
  }, [items]);

  const hasErrors = allErrors.length > 0;

  const getItemErrors = (itemId: string) => {
    return allErrors.filter(e => e.itemId === itemId);
  };

  const statistics = useMemo(() => {
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalWeight = items.reduce((sum, item) => sum + item.weight * item.quantity, 0);
    const totalVolume = items.reduce((sum, item) => {
      const volumeCm3 = item.length * item.width * item.height * item.quantity;
      return sum + volumeCm3 / 1000000; // Convert to m³
    }, 0);
    
    return { totalItems, totalWeight, totalVolume };
  }, [items]);

  const handleCellEdit = (itemId: string, field: keyof PackingItem, value: string) => {
    const updatedItems = items.map(item => {
      if (item.id === itemId) {
        const numericFields = ['length', 'width', 'height', 'weight', 'quantity'];
        const newValue = numericFields.includes(field) ? parseFloat(value) || 0 : value;
        return { ...item, [field]: newValue };
      }
      return item;
    });
    onItemsChange(updatedItems);
  };

  const renderEditableCell = (
    item: PackingItem,
    field: keyof PackingItem,
    value: string | number
  ) => {
    const isEditing = editingCell?.id === item.id && editingCell?.field === field;
    const itemErrors = getItemErrors(item.id);
    const hasFieldError = itemErrors.some(e => e.field === field);

    if (isEditing) {
      return (
        <Input
          autoFocus
          defaultValue={value}
          className={`h-8 w-full ${hasFieldError ? 'border-destructive' : ''}`}
          onBlur={(e) => {
            handleCellEdit(item.id, field, e.target.value);
            setEditingCell(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleCellEdit(item.id, field, e.currentTarget.value);
              setEditingCell(null);
            }
            if (e.key === 'Escape') {
              setEditingCell(null);
            }
          }}
        />
      );
    }

    return (
      <span
        className={`cursor-pointer hover:bg-muted px-2 py-1 rounded block ${
          hasFieldError ? 'text-destructive font-medium' : ''
        }`}
        onDoubleClick={() => setEditingCell({ id: item.id, field })}
      >
        {value}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="rounded-full bg-primary/10 p-3">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total articles</p>
              <p className="text-2xl font-bold">{statistics.totalItems}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="rounded-full bg-primary/10 p-3">
              <Scale className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Poids total</p>
              <p className="text-2xl font-bold">{statistics.totalWeight.toFixed(1)} kg</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="rounded-full bg-primary/10 p-3">
              <Box className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Volume total</p>
              <p className="text-2xl font-bold">{statistics.totalVolume.toFixed(2)} m³</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Data Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Données importées</CardTitle>
            {hasErrors ? (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                {allErrors.length} erreur(s)
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 bg-green-100 text-green-800">
                <Check className="h-3 w-3" />
                Données valides
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Double-cliquez sur une cellule pour la modifier
          </p>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-auto max-h-[400px]">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-[80px]">ID</TableHead>
                  <TableHead className="min-w-[200px]">Description</TableHead>
                  <TableHead className="w-[100px] text-right">L (cm)</TableHead>
                  <TableHead className="w-[100px] text-right">W (cm)</TableHead>
                  <TableHead className="w-[100px] text-right">H (cm)</TableHead>
                  <TableHead className="w-[100px] text-right">Poids (kg)</TableHead>
                  <TableHead className="w-[80px] text-right">Qté</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const itemErrors = getItemErrors(item.id);
                  const hasRowError = itemErrors.length > 0;
                  
                  return (
                    <TableRow
                      key={item.id}
                      className={hasRowError ? 'bg-destructive/5' : ''}
                    >
                      <TableCell className="font-mono text-sm">{item.id}</TableCell>
                      <TableCell>{renderEditableCell(item, 'description', item.description)}</TableCell>
                      <TableCell className="text-right">{renderEditableCell(item, 'length', item.length)}</TableCell>
                      <TableCell className="text-right">{renderEditableCell(item, 'width', item.width)}</TableCell>
                      <TableCell className="text-right">{renderEditableCell(item, 'height', item.height)}</TableCell>
                      <TableCell className="text-right">{renderEditableCell(item, 'weight', item.weight)}</TableCell>
                      <TableCell className="text-right">{renderEditableCell(item, 'quantity', item.quantity)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Validate Button */}
      <div className="flex justify-end">
        <Button
          onClick={onValidate}
          disabled={hasErrors}
          className="gap-2"
        >
          <Check className="h-4 w-4" />
          Valider les données
        </Button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface CreateTenderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTenderCreated?: (tenderId: string) => void;
}

const TENDER_TYPES = [
  { value: 'un_demobilization', label: 'UN Demobilization' },
  { value: 'un_rotation', label: 'UN Rotation' },
  { value: 'un_deployment', label: 'UN Deployment' },
  { value: 'private_tender', label: 'Tender Privé' },
  { value: 'government', label: 'Gouvernement' },
  { value: 'ngo', label: 'ONG' },
  { value: 'other', label: 'Autre' },
];

const ORIGIN_COUNTRIES = [
  'RCA', 'Mali', 'Soudan', 'Soudan du Sud', 'RDC', 'Côte d\'Ivoire',
  'Burkina Faso', 'Niger', 'Cameroun', 'Tchad', 'Sénégal', 'Autre'
];

export function CreateTenderDialog({ open, onOpenChange, onTenderCreated }: CreateTenderDialogProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    reference: '',
    client: '',
    tender_type: '',
    origin_country: '',
    deadline: undefined as Date | undefined,
    notes: '',
  });

  const createTenderMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('tender_projects')
        .insert({
          reference: formData.reference || `TENDER-${Date.now()}`,
          client: formData.client || null,
          tender_type: formData.tender_type || null,
          origin_country: formData.origin_country || null,
          deadline: formData.deadline?.toISOString() || null,
          notes: formData.notes || null,
          status: 'draft',
          cargo_summary: {},
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tender-projects'] });
      toast.success('Tender créé avec succès');
      onOpenChange(false);
      resetForm();
      if (onTenderCreated) {
        onTenderCreated(data.id);
      }
    },
    onError: (error) => {
      console.error('Error creating tender:', error);
      toast.error('Erreur lors de la création du tender');
    },
  });

  const resetForm = () => {
    setFormData({
      reference: '',
      client: '',
      tender_type: '',
      origin_country: '',
      deadline: undefined,
      notes: '',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.reference.trim()) {
      toast.error('La référence est requise');
      return;
    }
    createTenderMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Nouveau Tender</DialogTitle>
          <DialogDescription>
            Créez un nouveau projet tender multi-segments
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4">
            {/* Reference */}
            <div className="grid gap-2">
              <Label htmlFor="reference">Référence *</Label>
              <Input
                id="reference"
                placeholder="ex: RFPS-MINUSCA-2025-001"
                value={formData.reference}
                onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
              />
            </div>

            {/* Client */}
            <div className="grid gap-2">
              <Label htmlFor="client">Client</Label>
              <Input
                id="client"
                placeholder="ex: MINUSCA, UNMISS, UN..."
                value={formData.client}
                onChange={(e) => setFormData({ ...formData, client: e.target.value })}
              />
            </div>

            {/* Tender Type */}
            <div className="grid gap-2">
              <Label>Type de tender</Label>
              <Select
                value={formData.tender_type}
                onValueChange={(value) => setFormData({ ...formData, tender_type: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un type" />
                </SelectTrigger>
                <SelectContent>
                  {TENDER_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Origin Country */}
            <div className="grid gap-2">
              <Label>Pays d'origine</Label>
              <Select
                value={formData.origin_country}
                onValueChange={(value) => setFormData({ ...formData, origin_country: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un pays" />
                </SelectTrigger>
                <SelectContent>
                  {ORIGIN_COUNTRIES.map((country) => (
                    <SelectItem key={country} value={country}>
                      {country}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Deadline */}
            <div className="grid gap-2">
              <Label>Date limite de soumission</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !formData.deadline && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.deadline
                      ? format(formData.deadline, 'PPP', { locale: fr })
                      : 'Sélectionner une date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.deadline}
                    onSelect={(date) => setFormData({ ...formData, deadline: date })}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Notes */}
            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Informations supplémentaires..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createTenderMutation.isPending}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={createTenderMutation.isPending}>
              {createTenderMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Création...
                </>
              ) : (
                'Créer le tender'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

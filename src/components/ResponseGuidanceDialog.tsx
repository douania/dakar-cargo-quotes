import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { 
  Rocket, 
  DollarSign, 
  HelpCircle, 
  AlertTriangle, 
  XCircle,
  Loader2,
  Wand2
} from 'lucide-react';

interface ResponseGuidanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (instructions: string) => Promise<void>;
  emailSubject?: string;
  isRegenerating?: boolean;
}

interface Template {
  id: string;
  label: string;
  icon: React.ReactNode;
  instruction: string;
  color: string;
}

const TEMPLATES: Template[] = [
  {
    id: 'urgent',
    label: 'Réponse urgente',
    icon: <Rocket className="h-4 w-4" />,
    instruction: 'Traiter en priorité, proposer les délais les plus courts possibles.',
    color: 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400'
  },
  {
    id: 'competitive',
    label: 'Prix compétitif',
    icon: <DollarSign className="h-4 w-4" />,
    instruction: 'Proposer les meilleurs tarifs disponibles, être compétitif sur tous les postes.',
    color: 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400'
  },
  {
    id: 'info',
    label: 'Demander infos',
    icon: <HelpCircle className="h-4 w-4" />,
    instruction: 'Demander les informations manquantes avant de pouvoir établir une cotation précise.',
    color: 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400'
  },
  {
    id: 'risks',
    label: 'Avertir risques',
    icon: <AlertTriangle className="h-4 w-4" />,
    instruction: 'Mentionner les risques potentiels et les conditions particulières à prendre en compte.',
    color: 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400'
  },
  {
    id: 'decline',
    label: 'Refuser poliment',
    icon: <XCircle className="h-4 w-4" />,
    instruction: 'Décliner poliment cette demande en expliquant les raisons.',
    color: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'
  }
];

interface AdvancedOption {
  id: string;
  label: string;
  instruction: string;
}

const ADVANCED_OPTIONS: AdvancedOption[] = [
  { id: 'details', label: 'Inclure détail des calculs', instruction: 'Détailler tous les calculs et la décomposition des coûts.' },
  { id: 'table', label: 'Format tableau pour les postes', instruction: 'Présenter les postes de coûts sous forme de tableau structuré.' },
  { id: 'payment', label: 'Ajouter conditions de paiement', instruction: 'Inclure les conditions et modalités de paiement.' },
  { id: 'validity', label: 'Mentionner validité de la cotation', instruction: 'Préciser la durée de validité de cette cotation.' }
];

export function ResponseGuidanceDialog({ 
  open, 
  onOpenChange, 
  onGenerate,
  emailSubject,
  isRegenerating = false
}: ResponseGuidanceDialogProps) {
  const [customInstructions, setCustomInstructions] = useState('');
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const toggleTemplate = (templateId: string) => {
    setSelectedTemplates(prev => 
      prev.includes(templateId) 
        ? prev.filter(t => t !== templateId)
        : [...prev, templateId]
    );
  };

  const toggleOption = (optionId: string) => {
    setSelectedOptions(prev =>
      prev.includes(optionId)
        ? prev.filter(o => o !== optionId)
        : [...prev, optionId]
    );
  };

  const buildInstructions = (): string => {
    const parts: string[] = [];

    // Add template instructions
    selectedTemplates.forEach(templateId => {
      const template = TEMPLATES.find(t => t.id === templateId);
      if (template) parts.push(template.instruction);
    });

    // Add advanced options
    selectedOptions.forEach(optionId => {
      const option = ADVANCED_OPTIONS.find(o => o.id === optionId);
      if (option) parts.push(option.instruction);
    });

    // Add custom instructions
    if (customInstructions.trim()) {
      parts.push(customInstructions.trim());
    }

    return parts.join(' ');
  };

  const handleGenerate = async (withInstructions: boolean) => {
    setIsGenerating(true);
    try {
      const instructions = withInstructions ? buildInstructions() : '';
      await onGenerate(instructions);
      // Reset form on success
      setCustomInstructions('');
      setSelectedTemplates([]);
      setSelectedOptions([]);
      onOpenChange(false);
    } finally {
      setIsGenerating(false);
    }
  };

  const hasAnyGuidance = customInstructions.trim() || selectedTemplates.length > 0 || selectedOptions.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            {isRegenerating ? 'Régénérer la réponse' : 'Guider la réponse AI'}
          </DialogTitle>
          <DialogDescription>
            {emailSubject && <span className="block truncate">Pour : {emailSubject}</span>}
            Personnalisez les instructions pour obtenir une réponse adaptée à vos besoins.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Quick Templates */}
          <div>
            <h4 className="text-sm font-medium mb-3">Templates rapides</h4>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map(template => (
                <Badge
                  key={template.id}
                  variant="outline"
                  className={`cursor-pointer transition-all px-3 py-1.5 ${
                    selectedTemplates.includes(template.id)
                      ? template.color + ' border-2'
                      : 'hover:bg-accent'
                  }`}
                  onClick={() => toggleTemplate(template.id)}
                >
                  {template.icon}
                  <span className="ml-1">{template.label}</span>
                </Badge>
              ))}
            </div>
          </div>

          {/* Custom Instructions */}
          <div>
            <h4 className="text-sm font-medium mb-2">Instructions personnalisées</h4>
            <Textarea
              placeholder="Ex: Être très compétitif sur les frais THC, proposer une alternative par voie terrestre, demander des précisions sur le poids exact..."
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              className="min-h-[100px] resize-none"
            />
          </div>

          {/* Advanced Options */}
          <div>
            <h4 className="text-sm font-medium mb-3">Options avancées</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ADVANCED_OPTIONS.map(option => (
                <div 
                  key={option.id}
                  className="flex items-center space-x-2"
                >
                  <Checkbox
                    id={option.id}
                    checked={selectedOptions.includes(option.id)}
                    onCheckedChange={() => toggleOption(option.id)}
                  />
                  <label
                    htmlFor={option.id}
                    className="text-sm cursor-pointer"
                  >
                    {option.label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Preview of combined instructions */}
          {hasAnyGuidance && (
            <div className="bg-muted/50 rounded-lg p-3">
              <h4 className="text-xs font-medium text-muted-foreground mb-1">Aperçu des instructions :</h4>
              <p className="text-sm">{buildInstructions()}</p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => handleGenerate(false)}
            disabled={isGenerating}
            className="sm:flex-1"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Générer sans instructions
          </Button>
          <Button
            onClick={() => handleGenerate(true)}
            disabled={isGenerating || !hasAnyGuidance}
            className="sm:flex-1"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 mr-2" />
            )}
            Générer avec instructions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

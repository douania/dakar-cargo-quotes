import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  ArrowRight, 
  Check, 
  Ship, 
  Package, 
  Calculator,
  User,
  MapPin,
  FileText,
  Loader2
} from 'lucide-react';
import { Header } from '@/components/Header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface QuotationData {
  // Step 1: Client
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  // Step 2: Cargo
  cargoDescription: string;
  hsCode: string;
  weight: string;
  volume: string;
  containerType: string;
  containerCount: string;
  // Step 3: Route
  origin: string;
  destination: string;
  incoterm: string;
  // Step 4: Details
  specialRequirements: string;
  expectedDate: string;
}

const initialData: QuotationData = {
  clientName: '',
  clientEmail: '',
  clientPhone: '',
  cargoDescription: '',
  hsCode: '',
  weight: '',
  volume: '',
  containerType: '40HC',
  containerCount: '1',
  origin: '',
  destination: 'SNDKR',
  incoterm: 'CIF',
  specialRequirements: '',
  expectedDate: '',
};

const steps = [
  { id: 1, title: 'Client', icon: User, description: 'Informations client' },
  { id: 2, title: 'Marchandise', icon: Package, description: 'Détails du cargo' },
  { id: 3, title: 'Itinéraire', icon: Ship, description: 'Origine et destination' },
  { id: 4, title: 'Récapitulatif', icon: FileText, description: 'Vérification finale' },
];

const containerTypes = [
  { value: '20DV', label: "20' Dry Van" },
  { value: '40DV', label: "40' Dry Van" },
  { value: '40HC', label: "40' High Cube" },
  { value: '20RF', label: "20' Reefer" },
  { value: '40RF', label: "40' Reefer" },
  { value: '20OT', label: "20' Open Top" },
  { value: '40OT', label: "40' Open Top" },
  { value: 'BREAKBULK', label: "Conventionnel" },
  { value: 'RORO', label: "RORO (Véhicule)" },
];

const incoterms = [
  { value: 'EXW', label: 'EXW - Ex Works' },
  { value: 'FCA', label: 'FCA - Free Carrier' },
  { value: 'FAS', label: 'FAS - Free Alongside Ship' },
  { value: 'FOB', label: 'FOB - Free On Board' },
  { value: 'CFR', label: 'CFR - Cost and Freight' },
  { value: 'CIF', label: 'CIF - Cost, Insurance, Freight' },
  { value: 'CPT', label: 'CPT - Carriage Paid To' },
  { value: 'CIP', label: 'CIP - Carriage and Insurance Paid' },
  { value: 'DAP', label: 'DAP - Delivered at Place' },
  { value: 'DPU', label: 'DPU - Delivered at Place Unloaded' },
  { value: 'DDP', label: 'DDP - Delivered Duty Paid' },
];

export default function QuotationForm() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [data, setData] = useState<QuotationData>(initialData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hsCodeSuggestions, setHsCodeSuggestions] = useState<Array<{ code: string; description: string }>>([]);

  const updateField = (field: keyof QuotationData, value: string) => {
    setData(prev => ({ ...prev, [field]: value }));
  };

  const searchHsCode = async (query: string) => {
    if (query.length < 2) {
      setHsCodeSuggestions([]);
      return;
    }

    try {
      const { data: codes } = await supabase
        .from('hs_codes')
        .select('code, description')
        .or(`code.ilike.%${query}%,description.ilike.%${query}%`)
        .limit(5);

      setHsCodeSuggestions(codes || []);
    } catch (error) {
      console.error('Error searching HS codes:', error);
    }
  };

  const handleNext = () => {
    if (currentStep < steps.length) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    
    try {
      // Call the chat edge function with the quotation data
      const { data: response, error } = await supabase.functions.invoke('chat', {
        body: {
          message: `Génère une cotation complète pour:
Client: ${data.clientName} (${data.clientEmail})
Marchandise: ${data.cargoDescription}
Code SH: ${data.hsCode}
Poids: ${data.weight} kg | Volume: ${data.volume} CBM
Conteneur: ${data.containerCount}x ${data.containerType}
Origine: ${data.origin}
Destination: ${data.destination}
Incoterm: ${data.incoterm}
Exigences: ${data.specialRequirements}
Date souhaitée: ${data.expectedDate}`,
          context: 'quotation_generation',
        },
      });

      if (error) throw error;

      toast.success('Cotation générée avec succès');
      navigate('/dashboard');
    } catch (error) {
      console.error('Error generating quotation:', error);
      toast.error('Erreur lors de la génération de la cotation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isStepValid = (step: number) => {
    switch (step) {
      case 1:
        return data.clientName.trim() !== '' && data.clientEmail.trim() !== '';
      case 2:
        return data.cargoDescription.trim() !== '';
      case 3:
        return data.origin.trim() !== '' && data.destination.trim() !== '';
      default:
        return true;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Nouvelle cotation</h1>
            <p className="text-muted-foreground">Saisie manuelle d'une demande de cotation</p>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-8">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div 
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg transition-colors cursor-pointer",
                  currentStep === step.id 
                    ? "bg-primary text-primary-foreground" 
                    : currentStep > step.id 
                    ? "bg-green-500/20 text-green-500"
                    : "bg-muted text-muted-foreground"
                )}
                onClick={() => currentStep > step.id && setCurrentStep(step.id)}
              >
                {currentStep > step.id ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <step.icon className="h-4 w-4" />
                )}
                <span className="hidden md:inline font-medium">{step.title}</span>
              </div>
              {index < steps.length - 1 && (
                <div className={cn(
                  "w-12 h-0.5 mx-2",
                  currentStep > step.id ? "bg-green-500" : "bg-muted"
                )} />
              )}
            </div>
          ))}
        </div>

        {/* Form Content */}
        <Card className="max-w-2xl mx-auto border-border/50 bg-gradient-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {(() => {
                const StepIcon = steps[currentStep - 1].icon;
                return <StepIcon className="h-5 w-5 text-primary" />;
              })()}
              {steps[currentStep - 1].title}
            </CardTitle>
            <CardDescription>{steps[currentStep - 1].description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Step 1: Client */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="clientName">Nom du client *</Label>
                  <Input
                    id="clientName"
                    value={data.clientName}
                    onChange={(e) => updateField('clientName', e.target.value)}
                    placeholder="Société ABC SARL"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clientEmail">Email *</Label>
                  <Input
                    id="clientEmail"
                    type="email"
                    value={data.clientEmail}
                    onChange={(e) => updateField('clientEmail', e.target.value)}
                    placeholder="contact@societe.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clientPhone">Téléphone</Label>
                  <Input
                    id="clientPhone"
                    value={data.clientPhone}
                    onChange={(e) => updateField('clientPhone', e.target.value)}
                    placeholder="+221 77 123 45 67"
                  />
                </div>
              </div>
            )}

            {/* Step 2: Cargo */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cargoDescription">Description de la marchandise *</Label>
                  <Textarea
                    id="cargoDescription"
                    value={data.cargoDescription}
                    onChange={(e) => updateField('cargoDescription', e.target.value)}
                    placeholder="Ex: Machines industrielles, pièces de rechange automobiles..."
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hsCode">Code SH (optionnel)</Label>
                  <Input
                    id="hsCode"
                    value={data.hsCode}
                    onChange={(e) => {
                      updateField('hsCode', e.target.value);
                      searchHsCode(e.target.value);
                    }}
                    placeholder="Ex: 8429.51.00"
                  />
                  {hsCodeSuggestions.length > 0 && (
                    <div className="border rounded-lg mt-1 divide-y">
                      {hsCodeSuggestions.map((hs) => (
                        <div
                          key={hs.code}
                          className="px-3 py-2 hover:bg-muted cursor-pointer text-sm"
                          onClick={() => {
                            updateField('hsCode', hs.code);
                            setHsCodeSuggestions([]);
                          }}
                        >
                          <span className="font-mono text-primary">{hs.code}</span>
                          <span className="ml-2 text-muted-foreground truncate">
                            {hs.description?.substring(0, 60)}...
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="weight">Poids (kg)</Label>
                    <Input
                      id="weight"
                      type="number"
                      value={data.weight}
                      onChange={(e) => updateField('weight', e.target.value)}
                      placeholder="18000"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="volume">Volume (CBM)</Label>
                    <Input
                      id="volume"
                      type="number"
                      value={data.volume}
                      onChange={(e) => updateField('volume', e.target.value)}
                      placeholder="55"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="containerType">Type de conteneur</Label>
                    <Select value={data.containerType} onValueChange={(v) => updateField('containerType', v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {containerTypes.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="containerCount">Nombre</Label>
                    <Input
                      id="containerCount"
                      type="number"
                      min="1"
                      value={data.containerCount}
                      onChange={(e) => updateField('containerCount', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Route */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="origin">Port/Lieu d'origine *</Label>
                  <Input
                    id="origin"
                    value={data.origin}
                    onChange={(e) => updateField('origin', e.target.value)}
                    placeholder="Ex: Shanghai, Rotterdam, Le Havre..."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="destination">Port de destination *</Label>
                  <Select value={data.destination} onValueChange={(v) => updateField('destination', v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SNDKR">Dakar (SNDKR)</SelectItem>
                      <SelectItem value="CIABJ">Abidjan (CIABJ)</SelectItem>
                      <SelectItem value="TGLFW">Lomé (TGLFW)</SelectItem>
                      <SelectItem value="GHTEM">Tema (GHTEM)</SelectItem>
                      <SelectItem value="NGLOS">Lagos (NGLOS)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="incoterm">Incoterm</Label>
                  <Select value={data.incoterm} onValueChange={(v) => updateField('incoterm', v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {incoterms.map((inc) => (
                        <SelectItem key={inc.value} value={inc.value}>
                          {inc.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expectedDate">Date souhaitée (optionnel)</Label>
                  <Input
                    id="expectedDate"
                    type="date"
                    value={data.expectedDate}
                    onChange={(e) => updateField('expectedDate', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="specialRequirements">Exigences particulières</Label>
                  <Textarea
                    id="specialRequirements"
                    value={data.specialRequirements}
                    onChange={(e) => updateField('specialRequirements', e.target.value)}
                    placeholder="Ex: Marchandise fragile, température contrôlée, urgent..."
                    rows={2}
                  />
                </div>
              </div>
            )}

            {/* Step 4: Summary */}
            {currentStep === 4 && (
              <div className="space-y-4">
                <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Client</p>
                      <p className="font-medium">{data.clientName}</p>
                      <p className="text-sm text-muted-foreground">{data.clientEmail}</p>
                    </div>
                    <Badge variant="outline" onClick={() => setCurrentStep(1)} className="cursor-pointer">
                      Modifier
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Marchandise</p>
                      <p className="font-medium">{data.cargoDescription}</p>
                      <div className="flex gap-3 mt-1 text-sm text-muted-foreground">
                        {data.hsCode && <span>SH: {data.hsCode}</span>}
                        {data.weight && <span>{data.weight} kg</span>}
                        {data.volume && <span>{data.volume} CBM</span>}
                      </div>
                      <p className="text-sm">{data.containerCount}x {data.containerType}</p>
                    </div>
                    <Badge variant="outline" onClick={() => setCurrentStep(2)} className="cursor-pointer">
                      Modifier
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Itinéraire</p>
                      <p className="font-medium flex items-center gap-2">
                        {data.origin}
                        <ArrowRight className="h-4 w-4" />
                        {data.destination}
                      </p>
                      <p className="text-sm text-muted-foreground">Incoterm: {data.incoterm}</p>
                      {data.expectedDate && (
                        <p className="text-sm text-muted-foreground">Date: {data.expectedDate}</p>
                      )}
                    </div>
                    <Badge variant="outline" onClick={() => setCurrentStep(3)} className="cursor-pointer">
                      Modifier
                    </Badge>
                  </div>
                  {data.specialRequirements && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-sm text-muted-foreground">Exigences</p>
                        <p className="text-sm">{data.specialRequirements}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between pt-4">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={currentStep === 1}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Précédent
              </Button>

              {currentStep < steps.length ? (
                <Button
                  onClick={handleNext}
                  disabled={!isStepValid(currentStep)}
                >
                  Suivant
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="bg-primary hover:bg-primary/90"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Génération...
                    </>
                  ) : (
                    <>
                      <Calculator className="h-4 w-4 mr-2" />
                      Générer la cotation
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

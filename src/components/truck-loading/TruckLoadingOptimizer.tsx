import { useState } from 'react';
import { Upload, ClipboardCheck, BarChart3, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { PackingListUploader } from './PackingListUploader';
import { DataValidationTable } from './DataValidationTable';
import { FleetSuggestionResults } from './FleetSuggestionResults';
import { PackingItem, WorkflowStep } from '@/types/truckLoading';

const steps = [
  { number: 1, title: 'Import', description: 'Charger la liste', icon: Upload },
  { number: 2, title: 'Validation', description: 'Vérifier les données', icon: ClipboardCheck },
  { number: 3, title: 'Résultats', description: 'Scénarios optimaux', icon: BarChart3 },
];

export function TruckLoadingOptimizer() {
  const [currentStep, setCurrentStep] = useState<WorkflowStep>(1);
  const [packingItems, setPackingItems] = useState<PackingItem[]>([]);

  const handleUploadComplete = (items: PackingItem[]) => {
    setPackingItems(items);
    setCurrentStep(2);
  };

  const handleValidation = () => {
    setCurrentStep(3);
  };

  const handleReset = () => {
    setPackingItems([]);
    setCurrentStep(1);
  };

  return (
    <div className="space-y-8">
      {/* Stepper */}
      <div className="relative">
        <div className="flex justify-between items-center">
          {steps.map((step) => {
            const StepIcon = step.icon;
            const isActive = currentStep === step.number;
            const isCompleted = currentStep > step.number;
            
            return (
              <div key={step.number} className="flex flex-col items-center relative z-10">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${
                    isCompleted
                      ? 'bg-primary text-primary-foreground'
                      : isActive
                      ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <StepIcon className="h-5 w-5" />
                  )}
                </div>
                <div className="mt-2 text-center">
                  <p
                    className={`text-sm font-medium ${
                      isActive || isCompleted ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {step.title}
                  </p>
                  <p className="text-xs text-muted-foreground hidden md:block">
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Progress line */}
        <div className="absolute top-6 left-0 right-0 h-0.5 bg-muted -z-0">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* Step Content */}
      <Card>
        <CardContent className="pt-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              {currentStep === 1 && (
                <PackingListUploader onUploadComplete={handleUploadComplete} />
              )}
              
              {currentStep === 2 && (
                <DataValidationTable
                  items={packingItems}
                  onItemsChange={setPackingItems}
                  onValidate={handleValidation}
                />
              )}
              
              {currentStep === 3 && (
                <FleetSuggestionResults
                  items={packingItems}
                  onReset={handleReset}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>
    </div>
  );
}

import { Truck } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { TruckLoadingOptimizer } from '@/components/truck-loading/TruckLoadingOptimizer';

const TruckLoading = () => {
  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="rounded-lg bg-primary/10 p-3">
            <Truck className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Optimisation Chargement Camions
            </h1>
            <p className="text-muted-foreground">
              Planifiez le chargement optimal de vos conteneurs à partir d'une liste de colisage Excel
            </p>
          </div>
        </div>

        {/* Main Optimizer Component */}
        <TruckLoadingOptimizer />
      </div>
    </MainLayout>
  );
};

export default TruckLoading;

import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthProvider';

interface RequireAuthProps {
  children: React.ReactNode;
}

export function RequireAuth({ children }: RequireAuthProps) {
  const { session, isLoading } = useAuth();
  const location = useLocation();

  // Loading state - écran minimal thème Maritime
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Chargement...</p>
        </div>
      </div>
    );
  }

  // Non authentifié - redirect vers /login avec state pour retour
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Authentifié - afficher le contenu protégé
  return <>{children}</>;
}

import { Navigate, useLocation } from 'react-router-dom';
import { Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from './AuthProvider';

interface RequireAuthProps {
  children: React.ReactNode;
}

export function RequireAuth({ children }: RequireAuthProps) {
  const { authStatus, retryAuth } = useAuth();
  const location = useLocation();

  // Loading state — max 10s then switches to timeout
  if (authStatus === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Chargement...</p>
        </div>
      </div>
    );
  }

  // Timeout — never redirect to login
  if (authStatus === 'timeout') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center">
          <WifiOff className="h-10 w-10 text-destructive" />
          <h2 className="text-lg font-semibold">Connexion lente</h2>
          <p className="text-sm text-muted-foreground">
            Le serveur met du temps à répondre. Vérification en cours…
          </p>
          <Button onClick={retryAuth} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Réessayer
          </Button>
        </div>
      </div>
    );
  }

  // Unauthenticated — the ONLY case that redirects to login
  if (authStatus === 'unauthenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Authenticated
  return <>{children}</>;
}

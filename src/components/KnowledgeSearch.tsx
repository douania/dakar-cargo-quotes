import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, 
  DollarSign, 
  Users, 
  FileText, 
  MessageSquare,
  Settings,
  Mail,
  Loader2,
  X,
  Command
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface SearchResult {
  id: string;
  name: string;
  description: string;
  category: string;
  confidence: number;
  is_validated: boolean;
  data: Record<string, unknown>;
}

const categoryConfig: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  tarif: { icon: DollarSign, label: 'Tarifs', color: 'text-green-600' },
  contact: { icon: Users, label: 'Contacts', color: 'text-blue-600' },
  condition: { icon: FileText, label: 'Conditions', color: 'text-purple-600' },
  quotation_exchange: { icon: MessageSquare, label: 'Échanges', color: 'text-amber-600' },
  quotation_template: { icon: FileText, label: 'Templates', color: 'text-indigo-600' },
  processus: { icon: Settings, label: 'Processus', color: 'text-gray-600' },
  email_template: { icon: Mail, label: 'Emails', color: 'text-pink-600' },
};

interface KnowledgeSearchProps {
  onSelectResult?: (result: SearchResult) => void;
  triggerButton?: React.ReactNode;
}

export function KnowledgeSearch({ onSelectResult, triggerButton }: KnowledgeSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const navigate = useNavigate();

  // Keyboard shortcut to open
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        const { data, error } = await supabase.functions.invoke('data-admin', {
          body: { action: 'search', data: { query } }
        });

        if (error) throw error;
        setResults(data?.results || []);
      } catch (err) {
        console.error('Search error:', err);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query]);

  const handleSelect = useCallback((result: SearchResult) => {
    if (onSelectResult) {
      onSelectResult(result);
    }
    setOpen(false);
    setQuery('');
  }, [onSelectResult]);

  const handleViewAll = useCallback(() => {
    navigate('/admin/knowledge');
    setOpen(false);
    setQuery('');
  }, [navigate]);

  // Group results by category
  const groupedResults = results.reduce((acc, result) => {
    const category = result.category;
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(result);
    return acc;
  }, {} as Record<string, SearchResult[]>);

  const formatValue = (data: Record<string, unknown>) => {
    if (data.montant && data.devise) {
      return `${data.montant} ${data.devise}`;
    }
    if (data.email) {
      return data.email as string;
    }
    if (data.destination) {
      return `→ ${data.destination}`;
    }
    return null;
  };

  return (
    <>
      {triggerButton ? (
        <div onClick={() => setOpen(true)}>{triggerButton}</div>
      ) : (
        <Button
          variant="outline"
          className="relative w-full justify-start text-sm text-muted-foreground sm:pr-12 md:w-64"
          onClick={() => setOpen(true)}
        >
          <Search className="mr-2 h-4 w-4" />
          <span className="hidden lg:inline-flex">Rechercher connaissances...</span>
          <span className="inline-flex lg:hidden">Rechercher...</span>
          <kbd className="pointer-events-none absolute right-1.5 top-1.5 hidden h-6 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
            <span className="text-xs">⌘</span>K
          </kbd>
        </Button>
      )}

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput 
          placeholder="Rechercher contacts, tarifs, conditions..." 
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {isSearching && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          
          {!isSearching && query.length >= 2 && results.length === 0 && (
            <CommandEmpty>Aucun résultat pour "{query}"</CommandEmpty>
          )}

          {!isSearching && query.length < 2 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Tapez au moins 2 caractères pour rechercher
            </div>
          )}

          {Object.entries(groupedResults).map(([category, items]) => {
            const config = categoryConfig[category] || { 
              icon: FileText, 
              label: category, 
              color: 'text-gray-600' 
            };
            const Icon = config.icon;

            return (
              <CommandGroup key={category} heading={config.label}>
                {items.slice(0, 5).map((result) => (
                  <CommandItem
                    key={result.id}
                    value={`${result.name} ${result.description}`}
                    onSelect={() => handleSelect(result)}
                    className="flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Icon className={cn("h-4 w-4 shrink-0", config.color)} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {result.name.replace(/_/g, ' ')}
                        </p>
                        {result.description && (
                          <p className="text-xs text-muted-foreground truncate">
                            {result.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {formatValue(result.data) && (
                        <Badge variant="secondary" className="font-mono text-xs">
                          {formatValue(result.data)}
                        </Badge>
                      )}
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "text-xs",
                          result.is_validated 
                            ? "border-green-500/50 text-green-600" 
                            : "border-muted"
                        )}
                      >
                        {Math.round(result.confidence * 100)}%
                      </Badge>
                    </div>
                  </CommandItem>
                ))}
                {items.length > 5 && (
                  <div className="px-2 py-1 text-xs text-muted-foreground">
                    +{items.length - 5} autres résultats
                  </div>
                )}
              </CommandGroup>
            );
          })}

          {results.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem onSelect={handleViewAll} className="justify-center">
                  <span className="text-sm text-muted-foreground">
                    Voir toutes les connaissances →
                  </span>
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}

/**
 * Phase 8.8 + CL1 — Panneau de clarification léger
 * 
 * CTO RULE: This panel NEVER triggers any backend mutation
 * EXCEPT the mark-sent action (CL1 addition).
 * ❌ No supabase calls (other than mark-sent)
 * ❌ No status changes
 * ❌ No email sending
 * ✅ Copy to clipboard only (manual operator action)
 * ✅ Mark as sent for conversation tracking (CL1)
 */

import { useState } from 'react';
import { Copy, Check, Mail, AlertTriangle, ChevronDown, ChevronUp, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';

interface DetectedAmbiguity {
  type: string;
  excerpt: string;
  question_fr: string;
  question_en?: string;
}

interface ClarificationDraft {
  subject_fr?: string;
  subject_en?: string;
  body_fr: string;
  body_en?: string;
}

interface Props {
  draft: ClarificationDraft | null;
  ambiguities?: DetectedAmbiguity[];
  isLoading?: boolean;
  onClose?: () => void;
  // CL1 additions
  gapKeys?: string[];
  onMarkSent?: () => void;
  markSentDisabled?: boolean;
  isMarkingSent?: boolean;
}

const AMBIGUITY_LABELS: Record<string, { label: string; icon: string }> = {
  temporary_import: { label: 'Admission temporaire', icon: '🔄' },
  multi_destination: { label: 'Multi-destinations', icon: '📍' },
  unclear_incoterm: { label: 'Incoterm flou', icon: '📦' },
  service_scope: { label: 'Services ambigus', icon: '⚙️' },
  cargo_detail: { label: 'Détail cargo', icon: '📋' },
  timing: { label: 'Délais', icon: '⏰' },
};

export function ClarificationPanel({ draft, ambiguities = [], isLoading, onClose, gapKeys, onMarkSent, markSentDisabled, isMarkingSent }: Props) {
  const [copied, setCopied] = useState(false);
  const [language, setLanguage] = useState<'fr' | 'en'>('fr');
  const [showAmbiguities, setShowAmbiguities] = useState(true);

  if (isLoading) {
    return (
      <Card className="border-blue-200 bg-blue-50/50">
        <CardContent className="py-8">
          <div className="flex items-center justify-center gap-3 text-blue-700">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Analyse de la demande en cours...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!draft) return null;

  const currentBody = language === 'fr' ? draft.body_fr : (draft.body_en || draft.body_fr);
  const currentSubject = language === 'fr' ? draft.subject_fr : (draft.subject_en || draft.subject_fr);

  const handleCopy = async () => {
    try {
      const textToCopy = currentSubject 
        ? `Objet: ${currentSubject}\n\n${currentBody}`
        : currentBody;
      
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      toast.success('Email de clarification copié');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Erreur lors de la copie');
    }
  };

  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-lg text-blue-900">Email de clarification</CardTitle>
          </div>
          <Tabs value={language} onValueChange={(v) => setLanguage(v as 'fr' | 'en')} className="w-auto">
            <TabsList className="h-8">
              <TabsTrigger value="fr" className="text-xs px-3 h-6">🇫🇷 FR</TabsTrigger>
              <TabsTrigger value="en" className="text-xs px-3 h-6">🇬🇧 EN</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <CardDescription className="text-blue-700">
          À réviser puis copier dans votre client email
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Ambiguïtés détectées */}
        {ambiguities.length > 0 && (
          <AmbiguitiesSection
            ambiguities={ambiguities}
            language={language}
            showAmbiguities={showAmbiguities}
            setShowAmbiguities={setShowAmbiguities}
          />
        )}

        {/* Sujet */}
        {currentSubject && (
          <div className="space-y-1">
            <label className="text-sm font-medium text-blue-800">Objet</label>
            <div className="text-sm p-2 bg-white rounded border border-blue-200">
              {currentSubject}
            </div>
          </div>
        )}

        {/* Corps de l'email */}
        <div className="space-y-1">
          <label className="text-sm font-medium text-blue-800">Message</label>
          <Textarea 
            value={currentBody}
            readOnly
            className="min-h-[200px] bg-white border-blue-200 text-sm font-mono"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2">
          <Button 
            onClick={handleCopy}
            className="flex-1"
            variant={copied ? "secondary" : "default"}
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 mr-2" />
                Copié !
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                Copier l'email
              </>
            )}
          </Button>
          {/* CL1: Mark as sent button */}
          {onMarkSent && (
            <Button
              variant="outline"
              onClick={onMarkSent}
              disabled={markSentDisabled || isMarkingSent}
              title={markSentDisabled ? "Tous les gaps ont déjà été marqués comme envoyés" : "Confirmer l'envoi manuel de la clarification"}
            >
              {isMarkingSent ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Marquer comme envoyé
            </Button>
          )}
          {onClose && (
            <Button variant="outline" onClick={onClose}>
              Fermer
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          ⚠️ Révisez le contenu avant envoi. L'email n'est pas envoyé automatiquement.
        </p>
      </CardContent>
    </Card>
  );
}

// Extracted sub-component for ambiguities
function AmbiguitiesSection({
  ambiguities,
  language,
  showAmbiguities,
  setShowAmbiguities,
}: {
  ambiguities: DetectedAmbiguity[];
  language: 'fr' | 'en';
  showAmbiguities: boolean;
  setShowAmbiguities: (v: boolean) => void;
}) {
  return (
    <Collapsible open={showAmbiguities} onOpenChange={setShowAmbiguities}>
      <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-amber-700 hover:text-amber-800 transition-colors w-full">
        <AlertTriangle className="h-4 w-4" />
        <span>{ambiguities.length} ambiguïté{ambiguities.length > 1 ? 's' : ''} détectée{ambiguities.length > 1 ? 's' : ''}</span>
        {showAmbiguities ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <div className="space-y-2 pl-6">
          {ambiguities.map((amb, idx) => {
            const ambInfo = AMBIGUITY_LABELS[amb.type] || { label: amb.type, icon: '❓' };
            return (
              <div key={idx} className="text-sm p-2 bg-amber-50 rounded border border-amber-200">
                <div className="flex items-center gap-2 mb-1">
                  <span>{ambInfo.icon}</span>
                  <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">
                    {ambInfo.label}
                  </Badge>
                </div>
                {amb.excerpt && (
                  <p className="text-xs text-muted-foreground italic mb-1">
                    « {amb.excerpt.substring(0, 100)}{amb.excerpt.length > 100 ? '...' : ''} »
                  </p>
                )}
                <p className="text-amber-800">
                  {language === 'fr' ? amb.question_fr : (amb.question_en || amb.question_fr)}
                </p>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

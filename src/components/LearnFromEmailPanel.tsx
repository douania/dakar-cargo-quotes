import { useState } from 'react';
import { 
  GraduationCap, 
  BookOpen, 
  CheckCircle, 
  Loader2,
  Ship,
  MapPin,
  Package,
  DollarSign,
  Calendar,
  TrendingUp,
  FileText
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ThreadEmail {
  id: string;
  subject: string | null;
  from_address: string;
  body_text: string | null;
  received_at: string;
  sent_at: string | null;
}

interface ExtractedKnowledge {
  category: string;
  name: string;
  description: string;
  confidence: number;
}

interface LearnFromEmailPanelProps {
  threadEmails: ThreadEmail[];
  emailDate: string;
  onLearningComplete: () => void;
}

export function LearnFromEmailPanel({ 
  threadEmails, 
  emailDate,
  onLearningComplete 
}: LearnFromEmailPanelProps) {
  const [isLearning, setIsLearning] = useState(false);
  const [learningProgress, setLearningProgress] = useState(0);
  const [extractedKnowledge, setExtractedKnowledge] = useState<ExtractedKnowledge[]>([]);
  const [learningComplete, setLearningComplete] = useState(false);

  const getAgeLabel = () => {
    const date = new Date(emailDate);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 30) {
      return { label: 'Demande Active', color: 'bg-green-500/10 text-green-600 border-green-200', icon: '🟢' };
    } else if (diffDays < 180) {
      return { label: 'Archive Récente', color: 'bg-orange-500/10 text-orange-600 border-orange-200', icon: '🟠' };
    } else {
      const years = Math.floor(diffDays / 365);
      return { 
        label: `Historique (${years > 0 ? years + ' an' + (years > 1 ? 's' : '') : Math.floor(diffDays / 30) + ' mois'})`, 
        color: 'bg-blue-500/10 text-blue-600 border-blue-200', 
        icon: '📚' 
      };
    }
  };

  const ageInfo = getAgeLabel();

  const handleLearnFromThread = async () => {
    setIsLearning(true);
    setLearningProgress(0);
    setExtractedKnowledge([]);

    try {
      // Progress simulation while learning
      const progressInterval = setInterval(() => {
        setLearningProgress(prev => Math.min(prev + 10, 90));
      }, 500);

      // Call the learn-from-content function for each email
      const allKnowledge: ExtractedKnowledge[] = [];
      
      for (let i = 0; i < threadEmails.length; i++) {
        const email = threadEmails[i];
        
        const { data, error } = await supabase.functions.invoke('learn-from-content', {
          body: { 
            contentType: 'email',
            contentId: email.id 
          }
        });

        if (!error && data?.extractions) {
          const knowledge = data.extractions.map((ext: any) => ({
            category: ext.category,
            name: ext.name,
            description: ext.description,
            confidence: ext.confidence
          }));
          allKnowledge.push(...knowledge);
        }

        setLearningProgress(((i + 1) / threadEmails.length) * 90);
      }

      clearInterval(progressInterval);
      setLearningProgress(100);
      setExtractedKnowledge(allKnowledge);
      setLearningComplete(true);
      
      toast.success(`${allKnowledge.length} éléments appris de ce dossier`);
      onLearningComplete();
    } catch (error) {
      console.error('Learning error:', error);
      toast.error('Erreur lors de l\'apprentissage');
    } finally {
      setIsLearning(false);
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'tarif': return <DollarSign className="h-4 w-4" />;
      case 'template': return <FileText className="h-4 w-4" />;
      case 'contact': return <Ship className="h-4 w-4" />;
      case 'negociation': return <TrendingUp className="h-4 w-4" />;
      case 'condition': return <Calendar className="h-4 w-4" />;
      case 'marchandise': return <Package className="h-4 w-4" />;
      default: return <BookOpen className="h-4 w-4" />;
    }
  };

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      tarif: 'Tarif',
      template: 'Template',
      contact: 'Contact',
      negociation: 'Négociation',
      condition: 'Condition',
      marchandise: 'Marchandise'
    };
    return labels[category] || category;
  };

  return (
    <Card className="border-2 border-blue-200 bg-blue-50/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-lg">Mode Apprentissage</CardTitle>
          </div>
          <Badge variant="outline" className={ageInfo.color}>
            {ageInfo.icon} {ageInfo.label}
          </Badge>
        </div>
        <CardDescription>
          Cet email est ancien. Utilisez-le pour enrichir la base de connaissances plutôt que pour coter.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {!learningComplete ? (
          <>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <BookOpen className="h-4 w-4" />
              <span>{threadEmails.length} email(s) dans ce fil de discussion</span>
            </div>

            {isLearning && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Analyse en cours...</span>
                  <span>{Math.round(learningProgress)}%</span>
                </div>
                <Progress value={learningProgress} className="h-2" />
              </div>
            )}

            <Button 
              onClick={handleLearnFromThread}
              disabled={isLearning}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {isLearning ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Apprentissage en cours...
                </>
              ) : (
                <>
                  <GraduationCap className="h-4 w-4 mr-2" />
                  Apprendre de ce dossier
                </>
              )}
            </Button>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">Apprentissage terminé</span>
            </div>

            {extractedKnowledge.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {extractedKnowledge.length} élément(s) extrait(s) :
                </p>
                <div className="grid gap-2">
                  {extractedKnowledge.map((knowledge, index) => (
                    <div 
                      key={index}
                      className="flex items-center gap-2 p-2 bg-white rounded-lg border"
                    >
                      <div className="text-blue-600">
                        {getCategoryIcon(knowledge.category)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{knowledge.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {knowledge.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="text-xs">
                          {getCategoryLabel(knowledge.category)}
                        </Badge>
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${
                            knowledge.confidence > 0.8 
                              ? 'text-green-600 border-green-200' 
                              : knowledge.confidence > 0.5 
                                ? 'text-yellow-600 border-yellow-200'
                                : 'text-gray-600 border-gray-200'
                          }`}
                        >
                          {Math.round(knowledge.confidence * 100)}%
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Aucune nouvelle connaissance extraite (peut-être déjà appris).
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useNavigate } from "react-router-dom";
import { 
  FileText, 
  Send, 
  AlertCircle, 
  CheckCircle2, 
  Loader2,
  ArrowRight,
  Building2,
  Mail,
  Hash
} from "lucide-react";
import { createIntake, type IntakeResponse } from "@/services/railwayApi";
import { WORKFLOW_LABELS } from "@/features/quotation/constants";
import { MainLayout } from "@/components/layout/MainLayout";

export default function Intake() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [customerRef, setCustomerRef] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<IntakeResponse | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await createIntake({
        source: { type: "email_text", text },
        client_name: clientName || undefined,
        client_email: clientEmail || undefined,
        customer_ref: customerRef || undefined,
      });

      setResult(data);
    } catch (err: any) {
      setError(err.message || "Erreur de connexion au serveur");
    } finally {
      setLoading(false);
    }
  }

  function handleViewCase() {
    if (result?.case_id) {
      navigate(`/case/${result.case_id}`);
    }
  }

  return (
    <MainLayout>
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <FileText className="h-8 w-8 text-primary" />
            Nouvelle Demande de Cotation
          </h1>
          <p className="text-muted-foreground mt-2">
            Collez le texte de la demande (email, notes, etc.) et le système analysera automatiquement la complexité.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Informations client */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Informations Client (optionnel)</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="clientName" className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Nom du client
                </Label>
                <Input
                  id="clientName"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="SODATRA"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientEmail" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" /> Email
                </Label>
                <Input
                  id="clientEmail"
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="contact@client.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerRef" className="flex items-center gap-2">
                  <Hash className="h-4 w-4" /> Référence client
                </Label>
                <Input
                  id="customerRef"
                  value={customerRef}
                  onChange={(e) => setCustomerRef(e.target.value)}
                  placeholder="REF-2025-001"
                />
              </div>
            </CardContent>
          </Card>

          {/* Texte de la demande */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Texte de la Demande</CardTitle>
              <CardDescription>
                Collez ici l'email, les notes ou toute description de la demande de transport
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                placeholder="Exemple: 
Bonjour,

Nous avons besoin d'un transport de Dakar vers Bamako.
Cargo: 10 colis, dont un de 2500kg (dimensions 3m x 2m x 1.5m).
Date souhaitée: 15 janvier 2026.

Merci de nous faire une cotation."
                className="font-mono text-sm"
              />
            </CardContent>
          </Card>

          {/* Bouton soumettre */}
          <div className="flex justify-end">
            <Button type="submit" disabled={loading || !text.trim()} size="lg">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Analyse en cours...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-5 w-5" />
                  Analyser la demande
                </>
              )}
            </Button>
          </div>
        </form>

        {/* Erreur */}
        {error && (
          <Alert variant="destructive" className="mt-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Résultat */}
        {result && (
          <Card className="mt-6 border-2 border-primary/20">
            <CardHeader className="bg-primary/5">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  Analyse terminée
                </CardTitle>
                <Badge className={WORKFLOW_LABELS[result.workflow_key]?.color || "bg-muted"}>
                  {WORKFLOW_LABELS[result.workflow_key]?.label || result.workflow_key}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              {/* KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-primary">{result.complexity_level}</div>
                  <div className="text-sm text-muted-foreground">Niveau de complexité</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-primary">{Math.round(result.confidence * 100)}%</div>
                  <div className="text-sm text-muted-foreground">Confiance</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-primary">{result.missing_fields.length}</div>
                  <div className="text-sm text-muted-foreground">Champs manquants</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-primary">{result.status}</div>
                  <div className="text-sm text-muted-foreground">Statut</div>
                </div>
              </div>

              {/* Champs manquants */}
              {result.missing_fields.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2 text-orange-700">Informations manquantes</h4>
                  <ul className="space-y-2">
                    {result.missing_fields.map((field, i) => (
                      <li key={i} className="flex items-start gap-2 p-3 bg-orange-50 rounded-lg">
                        <AlertCircle className="h-5 w-5 text-orange-500 mt-0.5" />
                        <div>
                          <div className="font-medium">{field.question}</div>
                          <div className="text-sm text-muted-foreground">Champ: {field.field}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Hypothèses */}
              {result.assumptions && result.assumptions.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Hypothèses détectées</h4>
                  <ul className="list-disc list-inside text-muted-foreground">
                    {result.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Route détectée */}
              {result.normalized_request?.route && (
                <div>
                  <h4 className="font-semibold mb-2">Route détectée</h4>
                  <div className="flex items-center gap-4 text-muted-foreground">
                    <span className="font-medium">
                      {result.normalized_request.route.origins?.[0]?.name || "?"}
                    </span>
                    <ArrowRight className="h-4 w-4" />
                    <span className="font-medium">
                      {result.normalized_request.route.destinations?.[0]?.name || "?"}
                    </span>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-4 pt-4 border-t">
                <Button variant="outline" onClick={() => setResult(null)}>
                  Nouvelle analyse
                </Button>
                <Button onClick={handleViewCase}>
                  Ouvrir le dossier
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}

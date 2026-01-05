import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText,
  Play,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  ArrowLeft,
  ListTodo,
  FileOutput,
  History,
  Inbox
} from "lucide-react";

const API_BASE = import.meta.env.VITE_TRUCK_LOADING_API_URL || "https://web-production-8afea.up.railway.app";

interface CaseData {
  success: boolean;
  case: {
    id: string;
    status: string;
    workflow_key: string;
    complexity_level: number;
    confidence: number | null;
    missing_fields: any[];
    assumptions: any[];
    normalized_request: any;
    client_name: string | null;
    client_email: string | null;
    customer_ref: string | null;
    created_at: string | null;
    updated_at: string | null;
  };
  inputs: any[];
  tasks: any[];
  outputs: any[];
  events: any[];
}

const statusIcons: Record<string, React.ReactNode> = {
  queued: <Clock className="h-4 w-4 text-gray-500" />,
  running: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
  done: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  skipped: <Clock className="h-4 w-4 text-gray-400" />,
};

const statusColors: Record<string, string> = {
  intake: "bg-gray-100 text-gray-800",
  needs_info: "bg-orange-100 text-orange-800",
  ready: "bg-blue-100 text-blue-800",
  running: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

const workflowLabels: Record<string, string> = {
  WF_SIMPLE_QUOTE: "Devis Simple",
  WF_STANDARD_QUOTE: "Devis Standard",
  WF_PROJECT_CARGO: "Project Cargo",
  WF_TENDER: "Appel d'Offres",
};

export default function CaseView() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<CaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function fetchCase() {
    if (!caseId) return;
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE}/api/casefiles/${caseId}`);
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Dossier non trouvé");
      }

      setData(result);
    } catch (err: any) {
      setError(err.message || "Erreur de connexion");
    } finally {
      setLoading(false);
    }
  }

  async function runWorkflow() {
    if (!caseId) return;
    setRunning(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE}/api/casefiles/${caseId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Erreur lors de l'exécution");
      }

      // Rafraîchir les données
      await fetchCase();
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'exécution");
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    fetchCase();
  }, [caseId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => navigate("/intake")} className="mt-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Retour
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const { case: caseInfo, inputs, tasks, outputs, events } = data;

  return (
    <div className="container mx-auto py-8 px-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Button variant="ghost" onClick={() => navigate("/intake")} className="mb-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <FileText className="h-6 w-6 text-primary" />
            Dossier {caseId?.slice(0, 8)}...
          </h1>
          {caseInfo.client_name && (
            <p className="text-gray-600">Client: {caseInfo.client_name}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Badge className={statusColors[caseInfo.status] || "bg-gray-100"}>
            {caseInfo.status}
          </Badge>
          <Badge variant="outline">
            {workflowLabels[caseInfo.workflow_key] || caseInfo.workflow_key}
          </Badge>
        </div>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Actions */}
      <Card className="mb-6">
        <CardContent className="py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-sm text-gray-500">Complexité:</span>
              <span className="ml-2 font-bold">{caseInfo.complexity_level}/4</span>
            </div>
            {caseInfo.confidence && (
              <div>
                <span className="text-sm text-gray-500">Confiance:</span>
                <span className="ml-2 font-bold">{Math.round(caseInfo.confidence * 100)}%</span>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={fetchCase} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Rafraîchir
            </Button>
            <Button
              onClick={runWorkflow}
              disabled={running || caseInfo.status === "running" || caseInfo.status === "completed"}
            >
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Exécution...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Exécuter le workflow
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="tasks" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="tasks" className="flex items-center gap-2">
            <ListTodo className="h-4 w-4" />
            Tâches ({tasks.length})
          </TabsTrigger>
          <TabsTrigger value="outputs" className="flex items-center gap-2">
            <FileOutput className="h-4 w-4" />
            Résultats ({outputs.length})
          </TabsTrigger>
          <TabsTrigger value="inputs" className="flex items-center gap-2">
            <Inbox className="h-4 w-4" />
            Entrées ({inputs.length})
          </TabsTrigger>
          <TabsTrigger value="events" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Historique ({events.length})
          </TabsTrigger>
        </TabsList>

        {/* Tasks Tab */}
        <TabsContent value="tasks">
          <Card>
            <CardHeader>
              <CardTitle>Tâches du workflow</CardTitle>
              <CardDescription>
                Workflow: {workflowLabels[caseInfo.workflow_key] || caseInfo.workflow_key}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {tasks.map((task: any, i: number) => (
                  <div
                    key={task.id || i}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      {statusIcons[task.status] || <Clock className="h-4 w-4" />}
                      <div>
                        <div className="font-medium">{task.step_key}</div>
                        {task.error && (
                          <div className="text-sm text-red-600">{task.error}</div>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline">{task.status}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Outputs Tab */}
        <TabsContent value="outputs">
          <Card>
            <CardHeader>
              <CardTitle>Résultats générés</CardTitle>
            </CardHeader>
            <CardContent>
              {outputs.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  Aucun résultat encore. Exécutez le workflow pour générer des résultats.
                </p>
              ) : (
                <div className="space-y-4">
                  {outputs.map((output: any, i: number) => (
                    <div key={output.id || i} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <Badge>{output.output_type}</Badge>
                        <span className="text-sm text-gray-500">
                          {output.created_at ? new Date(output.created_at).toLocaleString() : ""}
                        </span>
                      </div>
                      <pre className="bg-gray-50 p-3 rounded text-sm overflow-auto max-h-60">
                        {JSON.stringify(output.content_json, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Inputs Tab */}
        <TabsContent value="inputs">
          <Card>
            <CardHeader>
              <CardTitle>Données d'entrée</CardTitle>
            </CardHeader>
            <CardContent>
              {inputs.length === 0 ? (
                <p className="text-gray-500 text-center py-8">Aucune entrée enregistrée.</p>
              ) : (
                <div className="space-y-4">
                  {inputs.map((input: any, i: number) => (
                    <div key={input.id || i} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="outline">{input.source_type}</Badge>
                        <span className="text-sm text-gray-500">
                          {input.created_at ? new Date(input.created_at).toLocaleString() : ""}
                        </span>
                      </div>
                      {input.raw_text && (
                        <pre className="bg-gray-50 p-3 rounded text-sm whitespace-pre-wrap">
                          {input.raw_text}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Events Tab */}
        <TabsContent value="events">
          <Card>
            <CardHeader>
              <CardTitle>Historique des événements</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-auto">
                {events.map((event: any, i: number) => (
                  <div
                    key={event.id || i}
                    className="flex items-start gap-3 p-3 bg-gray-50 rounded text-sm"
                  >
                    <div className="text-gray-500 whitespace-nowrap">
                      {event.created_at ? new Date(event.created_at).toLocaleTimeString() : ""}
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      {event.event_type}
                    </Badge>
                    {event.payload && (
                      <code className="text-xs text-gray-600">
                        {JSON.stringify(event.payload)}
                      </code>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

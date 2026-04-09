/**
 * C1.2b — ServiceOverridePanel extrait de CaseView.tsx
 * Composant auto-contenu, zéro accès au state parent.
 */

import React, { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Package, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { SERVICE_PACKAGES, serviceTemplates } from "@/features/quotation/constants";
import { EXCLUSIVE_GROUPS } from "./constants";
import { isServiceCompatibleWithPackage } from "./helpers";

export function ServiceOverridePanel({
  facts,
  caseId,
  isLocked,
  onSaved,
}: {
  facts: any[];
  caseId: string;
  isLocked: boolean;
  onSaved: () => void;
}) {
  const packageFact = facts.find(
    (f: any) => f.fact_key === "service.package" && f.is_current
  );
  const packageKey = packageFact?.value_text;
  const packageServices = packageKey ? SERVICE_PACKAGES[packageKey] : null;

  // Parse existing overrides
  const overrideFact = facts.find(
    (f: any) => f.fact_key === "service.overrides" && f.is_current
  );
  const existingOverrides = useMemo<{ add: string[]; remove: string[] }>(() => {
    if (!overrideFact?.value_json) return { add: [], remove: [] };
    try {
      const raw = overrideFact.value_json;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return {
        add: Array.isArray(parsed.add) ? parsed.add : [],
        remove: Array.isArray(parsed.remove) ? parsed.remove : [],
      };
    } catch {
      return { add: [], remove: [] };
    }
  }, [overrideFact]);

  const [removedServices, setRemovedServices] = useState<Set<string>>(
    new Set(existingOverrides.remove)
  );
  const [addedServices, setAddedServices] = useState<Set<string>>(
    new Set(existingOverrides.add)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [showMore, setShowMore] = useState(false);

  // Reset when package changes
  React.useEffect(() => {
    setRemovedServices(new Set(existingOverrides.remove));
    setAddedServices(new Set(existingOverrides.add));
  }, [packageKey, existingOverrides]);

  // Read service.mode for contextual filtering
  const modeFact = facts.find(
    (f: any) => f.fact_key === "service.mode" && f.is_current
  );
  const serviceMode = modeFact?.value_text || "";

  // ── Empty-state mode: no package defined yet ──
  const [selectedPackage, setSelectedPackage] = useState<string>("");
  const [isSavingPackage, setIsSavingPackage] = useState(false);

  const handleSavePackage = async () => {
    if (!selectedPackage) return;
    setIsSavingPackage(true);
    try {
      const { error } = await supabase.functions.invoke("set-case-fact", {
        body: { case_id: caseId, fact_key: "service.package", value_text: selectedPackage },
      });
      if (error) throw error;
      toast.success(`Package "${selectedPackage.replace(/_/g, " ")}" enregistré`);
      onSaved();
    } catch (err: any) {
      toast.error(`Erreur : ${err.message}`);
    } finally {
      setIsSavingPackage(false);
    }
  };

  if (!packageServices || !packageKey) {
    return (
      <Card className="border-muted">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Aucun package de services défini</CardTitle>
          </div>
          <CardDescription>
            Sélectionnez le package de services correspondant à ce dossier pour activer le pricing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={selectedPackage} onValueChange={setSelectedPackage} disabled={isLocked}>
            <SelectTrigger>
              <SelectValue placeholder="Choisir un package…" />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(SERVICE_PACKAGES).map((key) => (
                <SelectItem key={key} value={key}>
                  {key.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handleSavePackage}
            disabled={!selectedPackage || isSavingPackage || isLocked}
            className="w-full gap-2"
            size="sm"
          >
            {isSavingPackage ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Enregistrement…
              </>
            ) : (
              "Enregistrer le package"
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const ALL_SERVICE_KEYS = new Set(serviceTemplates.map((t) => t.service));

  // Exclusive groups: if one member is in the package, hide the others
  const excludedByExclusive = new Set(
    EXCLUSIVE_GROUPS.flatMap((group) => {
      const inPackage = group.filter((k) => packageServices.includes(k));
      return inPackage.length > 0
        ? group.filter((k) => !packageServices.includes(k))
        : [];
    })
  );

  const extraServices = serviceTemplates.filter((t) => {
    if (packageServices.includes(t.service)) return false;
    if (!isServiceCompatibleWithPackage(t.service, packageKey, serviceMode)) return false;
    if (excludedByExclusive.has(t.service)) return false;
    return true;
  });
  const frequentExtra = extraServices.slice(0, 4);
  const restExtra = extraServices.slice(4);

  const toggleRemove = (key: string) => {
    setRemovedServices((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAdd = (key: string) => {
    setAddedServices((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const hasChanges =
    JSON.stringify([...removedServices].sort()) !==
      JSON.stringify([...new Set(existingOverrides.remove)].sort()) ||
    JSON.stringify([...addedServices].sort()) !==
      JSON.stringify([...new Set(existingOverrides.add)].sort());

  const handleSaveOverrides = async () => {
    setIsSaving(true);
    try {
      // Sanitize against allowlist
      const add = [...addedServices].filter((k) => ALL_SERVICE_KEYS.has(k));
      const remove = [...removedServices].filter((k) => ALL_SERVICE_KEYS.has(k));

      const { error } = await supabase.functions.invoke("set-case-fact", {
        body: {
          case_id: caseId,
          fact_key: "service.overrides",
          value_json: { add, remove },
        },
      });
      if (error) throw error;
      toast.success("Ajustements sauvegardés");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const getLabel = (key: string) =>
    serviceTemplates.find((t) => t.service === key)?.description || key;

  // Derive effective services for display
  const effectiveKeys = packageServices
    .filter((k: string) => !removedServices.has(k))
    .concat([...addedServices].filter((k) => !packageServices.includes(k)));

  return (
    <Card className="mt-4 border-primary/20">
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          Services du package : {packageKey.replace(/_/g, " ")}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Package services (removable) */}
        <div className="space-y-2">
          {packageServices.map((key: string) => (
            <label
              key={key}
              className="flex items-center gap-2 text-sm cursor-pointer"
            >
              <Checkbox
                checked={!removedServices.has(key)}
                onCheckedChange={() => toggleRemove(key)}
                disabled={isLocked}
              />
              <span className={removedServices.has(key) ? "line-through text-muted-foreground" : ""}>
                {getLabel(key)}
              </span>
              <Badge variant="outline" className="text-[10px] ml-auto">
                {key}
              </Badge>
            </label>
          ))}
        </div>

        {/* Extra services (addable) */}
        {(frequentExtra.length > 0) && (
          <>
            <Separator />
            <p className="text-xs text-muted-foreground font-medium">
              Services supplémentaires
            </p>
            <div className="space-y-2">
              {frequentExtra.map((t) => (
                <label
                  key={t.service}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={addedServices.has(t.service)}
                    onCheckedChange={() => toggleAdd(t.service)}
                    disabled={isLocked}
                  />
                  <span>{t.description}</span>
                  <Badge variant="outline" className="text-[10px] ml-auto">
                    {t.service}
                  </Badge>
                </label>
              ))}
              {restExtra.length > 0 && !showMore && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setShowMore(true)}
                >
                  + {restExtra.length} autres services
                </Button>
              )}
              {showMore &&
                restExtra.map((t) => (
                  <label
                    key={t.service}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={addedServices.has(t.service)}
                      onCheckedChange={() => toggleAdd(t.service)}
                      disabled={isLocked}
                    />
                    <span>{t.description}</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">
                      {t.service}
                    </Badge>
                  </label>
                ))}
            </div>
          </>
        )}

        {/* Effective count + save */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            {effectiveKeys.length} service(s) effectif(s)
          </span>
          <Button
            size="sm"
            onClick={handleSaveOverrides}
            disabled={isLocked || isSaving || !hasChanges}
          >
            {isSaving ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Check className="mr-1 h-3 w-3" />
            )}
            Valider les ajustements
          </Button>
        </div>
        {isLocked && (
          <p className="text-xs text-muted-foreground italic">
            Pricing en cours — modifications désactivées
          </p>
        )}
      </CardContent>
    </Card>
  );
}

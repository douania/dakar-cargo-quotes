

# PHASE DOCS-P0 — Gestion documentaire par dossier

## Statut : ✅ IMPLÉMENTÉ

Table `case_documents`, bucket `case-documents`, composant `CaseDocumentsTab`, onglet Documents dans CaseView.

---

# PHASE INTAKE-DOC — Intake par upload d'Ordre de Transit

## Statut : ✅ IMPLÉMENTÉ

### Modifications appliquées

| Fichier | Action | Détail |
|---------|--------|--------|
| Migration SQL | EXÉCUTÉE | `UNIQUE(case_id, file_name)` sur `case_documents` (idempotence) |
| `supabase/functions/analyze-document/index.ts` | MODIFIÉ | Ajout branche `transit_order` avec prompt spécialisé logistique Sénégal |
| `supabase/functions/parse-document/index.ts` | MODIFIÉ | Ajout validation taille serveur (10 MB max, HTTP 413) |
| `src/pages/Intake.tsx` | MODIFIÉ | Zone upload drag-and-drop, analyse IA, pré-remplissage, stockage post-création |

### Flux implémenté

```
Upload fichier (mémoire uniquement)
→ parse-document (extraction texte, crée doc en DB)
→ analyze-document (analysisType="transit_order")
→ pré-remplissage formulaire (client, cargo, route, etc.)
→ validation opérateur → createIntake (Railway API)
→ case_id obtenu → upload case-documents + insert DB + timeline event
```

### Micro-correctifs CTO appliqués

1. **Idempotence** : Contrainte UNIQUE(case_id, file_name) empêche les doublons
2. **Validation serveur** : parse-document rejette les fichiers > 10 MB (HTTP 413)
3. **Pas de stockage avant case** : fichier en mémoire jusqu'à obtention du case_id

### Sécurité

- Auth requise sur les deux Edge Functions
- Bucket `case-documents` privé (signed URLs)
- Pas de persistance fichier avant validation opérateur
- Timeline event pour traçabilité

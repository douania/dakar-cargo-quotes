

## Rapport CTO Phase 6D.2 — Statut DONE

### Verdict

**Phase 6D.2 est complète et conforme aux règles CTO.**

L'Edge Function `generate-quotation-pdf` est **100% snapshot-first** sans aucun reste Phase 5C.

---

### Preuves techniques

| Critère CTO | Statut | Vérification |
|-------------|--------|--------------|
| Aucun `QuotationData` | ✅ Validé | Recherche : 0 match dans le fichier |
| Aucun `TariffLine` | ✅ Validé | Recherche : 0 match dans le fichier |
| Aucun accès `tariff_lines` | ✅ Validé | Recherche : 0 match dans le fichier |
| Aucun accès `client_name` | ✅ Validé | Recherche : 0 match dans le fichier |
| Une seule fonction PDF | ✅ Validé | `generatePdfFromSnapshot()` uniquement |
| Snapshot comme source | ✅ Validé | `quotation.generated_snapshot as GeneratedSnapshot` |
| Ownership vérifié | ✅ Validé | `created_by !== user.id → 403` |
| Statut vérifié | ✅ Validé | `status !== 'generated' → 400` |
| `verify_jwt = true` | ✅ Validé | Ligne 7 de config.toml |
| Trace DB | ✅ Validé | Insert dans `quotation_documents` |
| Storage versionné | ✅ Validé | `Q-{id}/v{version}/quote-{id}-{ts}.pdf` |

---

### Correction cosmétique mineure (optionnelle)

**Fichier** : `src/components/QuotationPdfExport.tsx`

| Ligne | Actuel | Correction |
|-------|--------|------------|
| 3 | `Phase 5C` | `Phase 6D.2` |
| 56 | `status === 'draft' ? 'Document brouillon' : 'Document officiel'` | `'Document officiel'` (toujours) |

**Raison** : Le PDF ne peut plus être généré depuis un draft (le bouton est conditionné à `status === 'generated'`), donc la distinction est inutile.

---

### Ce qui reste hors scope (Phase 5C legacy)

Les références à `tariff_lines` trouvées dans d'autres fonctions sont **légitimes** :
- `create-quotation-draft/index.ts` : Gère la création de brouillons avec colonnes dénormalisées (Phase 5)
- `data-admin/index.ts` : Admin data, hors cycle devis
- `learn-quotation-puzzle/index.ts` : Apprentissage ML, hors cycle devis

Ces fonctions **ne génèrent pas de PDF** et ne sont pas concernées par Phase 6D.2.

---

### Recommandation finale

1. **Appliquer la correction cosmétique** (2 lignes) pour cohérence documentaire
2. **Marquer Phase 6D.2 comme DONE**
3. **Passer à Phase 6D.3** (si prévue) ou valider le cycle complet

---

### Fichiers impactés (correction cosmétique uniquement)

| Fichier | Modification |
|---------|-------------|
| `src/components/QuotationPdfExport.tsx` | Mise à jour commentaire + simplification toast |

---

### Critères de DONE Phase 6D.2 — Tous validés

- ✅ PDF généré depuis `generated_snapshot` uniquement
- ✅ PDF stocké dans `quotation-attachments` bucket  
- ✅ Trace écrite dans `quotation_documents`
- ✅ Ownership vérifié (403 si mauvais user)
- ✅ Statut vérifié (400 si pas `generated`)
- ✅ Bouton visible uniquement si `status === 'generated'`
- ✅ Contenu PDF = projection fidèle du snapshot
- ✅ Aucune dette ajoutée
- ✅ Aucun reste Phase 5C dans la fonction PDF


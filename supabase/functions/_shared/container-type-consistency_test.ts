/**
 * Cohérence des tables de types de conteneur (filet, pas refactor).
 *
 * Un type de conteneur est déclaré dans QUATRE tables indépendantes, réparties
 * sur trois modules :
 *
 *   1. `CONTAINER_PROFILES`             — `_shared/dpw-dthc-tariff.ts`
 *   2. `DTHC_CONTAINER_TYPE_ALIASES`    — `_shared/dpw-dthc-tariff.ts`
 *   3. `EVP_CONVERSION`                 — `_shared/quotation-rules.ts`
 *   4. `LOCAL_TRANSPORT_CONTAINER_ALIASES` — `_shared/local-transport-destination.ts`
 *
 * Rien ne les relie. Ajouter un type dans l'une ne l'ajoute nulle part ailleurs,
 * et RIEN N'ÉCHOUE pour le signaler : la manutention portuaire résout, la
 * livraison terrestre répond `CONTAINER_UNSUPPORTED`, et le devis sort à moitié
 * chiffré sans erreur visible. Deux dérives réelles ont été constatées de cette
 * façon — le 20 pieds high cube (DTHC-4-B) puis le flat `20FL`/`40FL` (DTHC-4-C,
 * ajouté aux profils sans être inscrit dans `EVP_CONVERSION`).
 *
 * Ce fichier ne fusionne aucune table et ne change aucun comportement runtime :
 * il échoue quand les tables divergent. Aucune tolérance, aucune liste
 * d'exceptions — une divergence légitime doit être exprimée par une règle
 * explicite ci-dessous, jamais par un contournement au cas par cas.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CONTAINER_PROFILES,
  DTHC_CONTAINER_TYPE_ALIASES,
} from "./dpw-dthc-tariff.ts";
import { EVP_CONVERSION } from "./quotation-rules.ts";
import {
  LOCAL_TRANSPORT_CONTAINER_20,
  LOCAL_TRANSPORT_CONTAINER_40,
  resolveCanonicalLocalTransportContainerType,
} from "./local-transport-destination.ts";

/**
 * Le barème de livraison conteneur ne couvre QUE le 20 pieds et le 40 pieds
 * (`TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS`). Le 45 pieds n'y a pas de
 * ligne : son absence côté transport local est une décision de barème, pas une
 * dérive. C'est la seule exclusion par EVP, et elle est nommée ici.
 */
const LOCAL_TRANSPORT_COVERED_EVP: ReadonlySet<number> = new Set([1, 2]);

/**
 * Le module de transport local refuse délibérément de résoudre reefer, flat
 * rack, open top et tank : ces caisses n'ont pas de ligne au barème et leur
 * inventer une taille produirait un montant faux. Seul le sec est donc contrôlé.
 */
const LOCAL_TRANSPORT_COVERED_EQUIPMENT = "DRY";

Deno.test("CONTAINER_PROFILES et EVP_CONVERSION déclarent exactement les mêmes types", () => {
  const profiles = Object.keys(CONTAINER_PROFILES).sort();
  const evp = Object.keys(EVP_CONVERSION).sort();

  assertEquals(
    profiles,
    evp,
    "Les deux tables se déclarent mutuellement « strictement » la même liste " +
      "(cf. commentaire de CONTAINER_PROFILES). Un type ajouté d'un seul côté " +
      "tombe dans le repli par taille de getEVPMultiplier, qui rend le bon " +
      "chiffre par accident — jamais par construction.",
  );
});

Deno.test("CONTAINER_PROFILES et EVP_CONVERSION s'accordent sur le facteur EVP", () => {
  for (const [type, profile] of Object.entries(CONTAINER_PROFILES)) {
    assertEquals(
      EVP_CONVERSION[type],
      profile.evp,
      `${type} : les deux tables encodent l'EVP et doivent donner le même ` +
        `chiffre. Profil = ${profile.evp}, EVP_CONVERSION = ${
          EVP_CONVERSION[type]
        }.`,
    );
  }
});

Deno.test("tout alias DTHC vise un type réellement déclaré dans CONTAINER_PROFILES", () => {
  for (const [alias, target] of Object.entries(DTHC_CONTAINER_TYPE_ALIASES)) {
    assertEquals(
      Object.hasOwn(CONTAINER_PROFILES, target),
      true,
      `L'alias ${alias} -> ${target} est pendant : ${target} n'existe pas dans ` +
        `CONTAINER_PROFILES. normalizeDthcContainerType rendrait un type que ` +
        `resolveContainerProfile ne sait pas résoudre, donc un dossier sans DTHC.`,
    );
  }
});

Deno.test("tout conteneur sec 20/40 pieds résolu au port l'est aussi à la livraison", () => {
  for (const [type, profile] of Object.entries(CONTAINER_PROFILES)) {
    if (profile.equipment !== LOCAL_TRANSPORT_COVERED_EQUIPMENT) continue;
    if (!LOCAL_TRANSPORT_COVERED_EVP.has(profile.evp)) continue;

    const expected = profile.evp === 1
      ? LOCAL_TRANSPORT_CONTAINER_20
      : LOCAL_TRANSPORT_CONTAINER_40;

    assertEquals(
      resolveCanonicalLocalTransportContainerType(type),
      expected,
      `${type} est résolu par la manutention portuaire mais pas par la ` +
        `livraison terrestre : le dossier sort avec un DTHC chiffré et un ` +
        `transport en CONTAINER_UNSUPPORTED, sans erreur visible. Ajouter la ` +
        `clé à LOCAL_TRANSPORT_CONTAINER_ALIASES.`,
    );
  }
});

Deno.test("le 45 pieds reste hors barème de livraison, et c'est délibéré", () => {
  // Verrou d'intention : si un jour le barème couvre le 45 pieds, ce test
  // échoue et force à retirer l'exclusion ci-dessus plutôt qu'à la subir.
  for (const [type, profile] of Object.entries(CONTAINER_PROFILES)) {
    if (LOCAL_TRANSPORT_COVERED_EVP.has(profile.evp)) continue;
    assertEquals(
      resolveCanonicalLocalTransportContainerType(type),
      null,
      `${type} (${profile.evp} EVP) est hors des tailles couvertes par le ` +
        `barème 20P/40P : il ne doit pas se résoudre silencieusement vers une ` +
        `taille inventée.`,
    );
  }
});

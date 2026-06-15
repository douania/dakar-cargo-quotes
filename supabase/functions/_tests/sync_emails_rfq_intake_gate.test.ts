/**
 * DCQ-EMAIL-INTAKE-GATE-P0-1-2 — Qualification stricte d'entrée RFQ client.
 *
 * PORTÉE LIMITÉE :
 *   Teste UNIQUEMENT le helper pur `isLikelyClientRfqThread()` et le gate
 *   `isQuotationThread()` de sync-emails. Aucun appel IMAP, aucune DB :
 *   les rôles (threadRoles) sont fournis directement comme ils le seraient
 *   après determineThreadRoles().
 *
 * Exécution :
 *   deno test --allow-env supabase/functions/_tests/sync_emails_rfq_intake_gate.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Empêche le serveur HTTP de démarrer lors de l'import (cf. build-case-puzzle).
Deno.env.set("SYNC_EMAILS_DISABLE_SERVE", "1");

const { isLikelyClientRfqThread, isQuotationThread } = await import(
  "../sync-emails/index.ts"
);

// ─── Helpers de construction ─────────────────────────────────────────
type Email = {
  from_address: string;
  to_addresses: string[];
  cc_addresses?: string[];
  sent_at: string;
  subject?: string;
  body_text?: string;
};

type Participant = {
  email: string;
  role: string;
  company: string;
  isKnown: boolean;
};

const SODATRA = "ops@sodatra.sn";

function roles(opts: {
  clientEmail?: string;
  partnerEmail?: string | null;
  ourRole?: "direct_quote" | "assist_partner";
  participants: Participant[];
}) {
  return {
    clientEmail: opts.clientEmail ?? "",
    partnerEmail: opts.partnerEmail ?? null,
    ourRole: opts.ourRole ?? "direct_quote",
    participants: opts.participants,
  };
}

// ─── 1. Vrai RFQ externe entrant → cotation ──────────────────────────
Deno.test("1 - Vrai RFQ externe entrant reste cotation", () => {
  const emails: Email[] = [
    {
      from_address: "buyer@acme-import.com",
      to_addresses: [SODATRA],
      sent_at: "2026-06-10T09:00:00Z",
      body_text:
        "Bonjour, demande de cotation pour un sea freight 2x40HC Shanghai - Dakar port, CIF. Merci.",
    },
  ];
  const r = roles({
    clientEmail: "buyer@acme-import.com",
    participants: [
      { email: "buyer@acme-import.com", role: "prospect", company: "ACME", isKnown: false },
      { email: SODATRA, role: "internal", company: "SODATRA", isKnown: true },
    ],
  });

  assertEquals(isLikelyClientRfqThread("import acme", emails, r), true);
  assertEquals(isQuotationThread("import acme", emails, r), true);
});

// ─── 2. Email sortant SODATRA vers fournisseur → PAS cotation client ──
Deno.test("2 - Sortant SODATRA vers fournisseur n'est pas RFQ client", () => {
  const emails: Email[] = [
    {
      from_address: SODATRA,
      to_addresses: ["sales@oceanline.com"],
      sent_at: "2026-06-10T09:00:00Z",
      body_text:
        "Bonjour, merci de nous transmettre votre request for quotation / cotation sea freight 1x20DV Dakar.",
    },
    {
      // réponse fournisseur : empêche l'exclusion "tous senders blacklistés"
      from_address: "sales@oceanline.com",
      to_addresses: [SODATRA],
      sent_at: "2026-06-10T11:00:00Z",
      body_text: "Voici notre offre ocean freight FCL.",
    },
  ];
  const r = roles({
    clientEmail: "sales@oceanline.com",
    participants: [
      { email: "sales@oceanline.com", role: "supplier", company: "OCEANLINE", isKnown: true },
      { email: SODATRA, role: "internal", company: "SODATRA", isKnown: true },
    ],
  });

  // Direction : premier email significatif = SODATRA -> externe ⇒ rejeté
  assertEquals(isLikelyClientRfqThread("cotation sea freight", emails, r), false);
  assertEquals(isQuotationThread("cotation sea freight", emails, r), false);
});

// ─── 3. Spam freight marketing → PAS de RFQ client ───────────────────
Deno.test("3 - Spam freight marketing sans demande adressee a SODATRA", () => {
  const emails: Email[] = [
    {
      from_address: "promo@globalfreight-news.com",
      to_addresses: [SODATRA],
      sent_at: "2026-06-10T09:00:00Z",
      subject: "Competitive ocean freight & sea freight FCL / LCL rates",
      body_text:
        "We offer the best ocean freight and sea freight rates worldwide. FCL LCL container 20 container 40.",
    },
  ];
  const r = roles({
    clientEmail: "promo@globalfreight-news.com",
    participants: [
      { email: "promo@globalfreight-news.com", role: "prospect", company: "GLOBALFREIGHT", isKnown: false },
      { email: SODATRA, role: "internal", company: "SODATRA", isKnown: true },
    ],
  });

  // Mots-clés logistiques nombreux MAIS aucune demande explicite + expéditeur inconnu
  assertEquals(isLikelyClientRfqThread("competitive ocean freight", emails, r), false);
  assertEquals(isQuotationThread("competitive ocean freight", emails, r), false);
});

// ─── 4. Fournisseur connu (default_role=supplier) non promu client ───
Deno.test("4 - Fournisseur connu non promu client par fallback", () => {
  const emails: Email[] = [
    {
      from_address: "quotes@maersk.com",
      to_addresses: [SODATRA],
      sent_at: "2026-06-10T09:00:00Z",
      // Contient même un mot-clé de demande : doit rester insuffisant car rôle=supplier
      body_text:
        "Please find our quotation. request for quotation reference. sea freight FCL 40HC.",
    },
  ];
  const r = roles({
    // Cas où determineThreadRoles aurait (à tort) mis le fournisseur en clientEmail
    clientEmail: "quotes@maersk.com",
    participants: [
      { email: "quotes@maersk.com", role: "supplier", company: "MAERSK", isKnown: true },
      { email: SODATRA, role: "internal", company: "SODATRA", isKnown: true },
    ],
  });

  assertEquals(isLikelyClientRfqThread("maersk offer", emails, r), false);
  assertEquals(isQuotationThread("maersk offer", emails, r), false);
});

// ─── 5. Partenaire : assist_partner préservé seulement si demande client ─
Deno.test("5a - Partenaire transmet une demande client claire (assist_partner)", () => {
  const emails: Email[] = [
    {
      from_address: "agent@partnerlogistics.com",
      to_addresses: [SODATRA],
      sent_at: "2026-06-10T09:00:00Z",
      body_text:
        "Cher SODATRA, notre client transmet une demande de cotation sea freight 2x40HC Dakar. Merci de coter.",
    },
  ];
  const r = roles({
    partnerEmail: "agent@partnerlogistics.com",
    ourRole: "assist_partner",
    // Client externe défendable identifié via citation (clientEmail), hors participants
    clientEmail: "client-final@enduser.com",
    participants: [
      { email: "agent@partnerlogistics.com", role: "partner", company: "PARTNERLOGISTICS", isKnown: true },
      { email: SODATRA, role: "internal", company: "SODATRA", isKnown: true },
    ],
  });

  assertEquals(isLikelyClientRfqThread("demande client via partenaire", emails, r), true);
  assertEquals(isQuotationThread("demande client via partenaire", emails, r), true);
});

Deno.test("5b - Partenaire sans demande client claire n'est pas RFQ", () => {
  const emails: Email[] = [
    {
      from_address: "agent@partnerlogistics.com",
      to_addresses: [SODATRA],
      sent_at: "2026-06-10T09:00:00Z",
      // Pas de demande explicite, juste du vocabulaire logistique générique
      body_text: "Hello, just sharing market update on ocean freight and sea freight trends.",
    },
  ];
  const r = roles({
    partnerEmail: "agent@partnerlogistics.com",
    ourRole: "assist_partner",
    clientEmail: "", // aucun client externe défendable
    participants: [
      { email: "agent@partnerlogistics.com", role: "partner", company: "PARTNERLOGISTICS", isKnown: true },
      { email: SODATRA, role: "internal", company: "SODATRA", isKnown: true },
    ],
  });

  assertEquals(isLikelyClientRfqThread("market update", emails, r), false);
  assertEquals(isQuotationThread("market update", emails, r), false);
});

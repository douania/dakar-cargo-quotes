/**
 * CLIENT-REPLY-LANGUAGE-INVARIANT-2
 * Tests purs pour la détection de langue client avec normalisation défensive
 * d'un corps MIME/base64 brut (helpers extraits de generate-reply-draft).
 *
 * Run: deno test supabase/functions/_tests/language_detection_base64.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  detectLanguage,
  normalizeTextForLanguageDetection,
} from "../_shared/language-detection.ts";

const detect = (raw: string) =>
  detectLanguage(normalizeTextForLanguageDetection(raw));

// 1. Texte anglais normal → "en"
Deno.test("1 - texte anglais normal est détecté en", () => {
  const text =
    "Dear Sir, please find attached our quotation. Could you confirm the freight rates? Best regards.";
  assertEquals(detect(text), "en");
});

// 2. Texte français normal → "fr"
Deno.test("2 - texte français normal est détecté fr", () => {
  const text =
    "Bonjour, merci de nous transmettre la cotation pour cette marchandise. Cordialement.";
  assertEquals(detect(text), "fr");
});

// 3. Corps base64 brut encodant un email anglais (Dear/please/Carrier/CMA CGM/DDP) → "en"
Deno.test("3 - corps base64 d'un email anglais est détecté en après normalisation", () => {
  // base64 de :
  // "Dear Cherif,\n\nWe got an update from customer. Could you please update
  //  the rates accordingly. Additionally, we are transporting buses in 40 FR
  //  (Carrier - CMA CGM). Please find attached our DDP offer."
  const base64Body =
    "RGVhciBDaGVyaWYsCgpXZSBnb3QgYW4gdXBkYXRlIGZyb20gY3VzdG9tZXIuIENvdWxkIHlvdSBwbGVhc2UgdXBkYXRlIHRoZSByYXRlcyBhY2NvcmRpbmdseS4gQWRkaXRpb25hbGx5LCB3ZSBhcmUgdHJhbnNwb3J0aW5nIGJ1c2VzIGluIDQwIEZSIChDYXJyaWVyIC0gQ01BIENHTSkuIFBsZWFzZSBmaW5kIGF0dGFjaGVkIG91ciBERFAgb2ZmZXIu";

  const normalized = normalizeTextForLanguageDetection(base64Body);
  // La normalisation doit restaurer les marqueurs anglais lisibles.
  assertEquals(normalized.includes("Dear"), true);
  assertEquals(normalized.includes("please"), true);
  assertEquals(normalized.includes("Carrier"), true);
  assertEquals(normalized.includes("CMA CGM"), true);
  assertEquals(normalized.includes("DDP"), true);
  // Et la détection doit donner "en" (et non le fallback "fr").
  assertEquals(detectLanguage(normalized), "en");
});

// 4. Un texte non-base64 ne doit pas être corrompu par la normalisation
Deno.test("4 - texte normal non-base64 n'est pas corrompu par la normalisation", () => {
  const text =
    "Bonjour, merci pour votre retour concernant les conteneurs.";
  assertEquals(normalizeTextForLanguageDetection(text), text);
});

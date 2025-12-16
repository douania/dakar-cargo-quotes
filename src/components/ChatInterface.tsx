import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { QuickActions } from "./QuickActions";
import { WelcomeSection } from "./WelcomeSection";
import { toast } from "sonner";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

// System prompt for the agent
const SYSTEM_PROMPT = `Tu es un AGENT IA EXPERT EN COTATION LOGISTIQUE MARITIME ET AÉRIENNE POUR LE SÉNÉGAL, spécialisé exclusivement sur le Port Autonome de Dakar et ses pratiques réelles.

Tu opères comme un transitaire sénégalais senior, avec une parfaite maîtrise :
- des Incoterms® 2020 (ICC)
- des pratiques portuaires locales (PAD / DP World Dakar)
- des procédures douanières sénégalaises (GAINDE / ORBUS)
- de la distinction stricte entre débours, honoraires et chiffre d'affaires

RÈGLES ABSOLUES:
1. Aucune cotation sans: Incoterm, Mode transport, Type marchandise, Type unité, Port/aéroport origine
2. Sépare TOUJOURS: Transport international, Frais portuaires, Manutention, Dédouanement, Débours douaniers, Honoraires
3. Les débours douaniers ne sont JAMAIS intégrés au chiffre d'affaires
4. Applique strictement les Incoterms
5. Utilise uniquement les grilles tarifaires officielles du Port de Dakar et DP World

Format tes réponses avec des tableaux Markdown clairs et structurés pour les cotations.
Pose des questions précises si des informations manquent.
Ton ton est professionnel et rigoureux.`;

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (content: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    // Simulate AI response (will be replaced with real API call when Cloud is connected)
    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: generateMockResponse(content),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsLoading(false);
    }, 1500);
  };

  const handleQuickAction = (prompt: string) => {
    handleSend(prompt);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto scrollbar-thin px-4 py-6"
      >
        <div className="max-w-3xl mx-auto">
          <AnimatePresence mode="wait">
            {messages.length === 0 ? (
              <motion.div
                key="welcome"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <WelcomeSection />
                <div className="mt-8">
                  <p className="text-sm text-muted-foreground mb-4 text-center">
                    Commencez par une action rapide ou décrivez votre besoin
                  </p>
                  <QuickActions onSelect={handleQuickAction} />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="chat"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-2"
              >
                {messages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    role={message.role}
                    content={message.content}
                  />
                ))}
                {isLoading && (
                  <ChatMessage
                    role="assistant"
                    content=""
                    isLoading
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-border bg-background/80 backdrop-blur-sm p-4">
        <div className="max-w-3xl mx-auto">
          <ChatInput onSend={handleSend} isLoading={isLoading} />
        </div>
      </div>
    </div>
  );
}

// Mock response generator (will be replaced with real AI when Cloud is connected)
function generateMockResponse(userMessage: string): string {
  const lowerMessage = userMessage.toLowerCase();
  
  if (lowerMessage.includes("conteneur") && lowerMessage.includes("40")) {
    return `Merci pour votre demande. Pour établir une cotation précise pour un conteneur 40' HC Shanghai → Dakar en CIF, j'ai besoin de quelques précisions :

**Informations requises :**
1. **Nature exacte de la marchandise** (code SH si disponible)
2. **Valeur CIF déclarée** (en USD ou FCFA)
3. **Date d'arrivée estimée** (pour calcul des franchises)

**Structure de la cotation prévisionnelle :**

| Poste | Description | Montant estimé |
|-------|-------------|----------------|
| Transport International | Fret maritime (inclus en CIF) | Payé par expéditeur |
| Frais portuaires PAD | Droits de port, redevances | À calculer |
| Manutention DP World | Débarquement 40' HC | ~ 180 000 FCFA |
| Dédouanement | Honoraires SODATRA | ~ 150 000 FCFA |
| Débours douaniers | DD + TVA (estimation) | Sur base valeur CIF |

⚠️ **Note importante** : Les débours douaniers seront calculés sur la valeur CIF déclarée et refacturés à l'identique (non inclus dans le CA).

Merci de me fournir les informations manquantes pour finaliser cette cotation.`;
  }
  
  if (lowerMessage.includes("aérien") || lowerMessage.includes("aibd")) {
    return `Pour votre demande de cotation fret aérien Paris CDG → Dakar AIBD (500 kg, FOB), voici les éléments :

**Informations à préciser :**
1. **Dimensions des colis** (pour calcul poids volumétrique)
2. **Nature de la marchandise** (classification IATA)
3. **Valeur FOB déclarée**

**Rappel règle IATA :**
- Poids taxable = MAX (poids réel, poids volumétrique)
- Poids volumétrique = L×l×H (cm) / 6000

**Structure prévisionnelle :**

| Poste | Description | Base |
|-------|-------------|------|
| Fret aérien | Tarif au kg taxable | En cours de cotation |
| Surcharge carburant | % du fret | Variable |
| Sûreté | Forfait | ~ 15 000 FCFA |
| Handling AIBD | Manutention | ~ 50 000 FCFA |
| Dédouanement | Honoraires | ~ 100 000 FCFA |
| Débours | DD + TVA | Sur valeur CAF |

En attente de vos précisions pour finaliser.`;
  }
  
  if (lowerMessage.includes("roro") || lowerMessage.includes("véhicule")) {
    return `Pour l'importation d'un véhicule d'occasion Anvers → Dakar (RORO, FOB), voici ma demande de précisions :

**Informations requises :**
1. **Type de véhicule** (berline, SUV, utilitaire)
2. **Année de mise en circulation**
3. **Cylindrée** (cm³)
4. **Valeur FOB déclarée** (attestation de valeur requise)

**⚠️ Réglementation véhicules d'occasion Sénégal :**
- Âge maximum : 8 ans pour les particuliers
- Malus écologique si > 5 ans
- Taxe spéciale selon cylindrée

**Structure prévisionnelle :**

| Poste | Applicable |
|-------|-----------|
| Fret maritime RORO | À charge du client (FOB) |
| Frais PAD véhicule | ~ 50 000 FCFA |
| Manutention | ~ 75 000 FCFA |
| Dédouanement | ~ 120 000 FCFA |
| Débours (DD + Malus + TVA) | Sur valeur argus |

Merci de me transmettre les caractéristiques du véhicule.`;
  }
  
  if (lowerMessage.includes("débours") || lowerMessage.includes("douaniers")) {
    return `Pour une marchandise générale d'une valeur CIF de 15 000 000 FCFA, voici une estimation des débours douaniers :

**⚠️ ESTIMATION - Les taux exacts dépendent du code SH**

| Taxe | Base | Taux | Montant estimé |
|------|------|------|----------------|
| Droit de Douane (DD) | Valeur CIF | 5-20%* | 750 000 - 3 000 000 FCFA |
| Redevance Statistique (RS) | Valeur CIF | 1% | 150 000 FCFA |
| Prélèvement COSEC | Valeur CIF | 0,4% | 60 000 FCFA |
| TVA | CIF + DD + RS | 18% | ~ 2 900 000 - 3 300 000 FCFA |

**Total estimé débours : 3 860 000 à 6 510 000 FCFA**

*Le taux DD varie selon la position tarifaire (code SH).

**Rappel important :**
- Ces débours sont refacturés à l'identique
- Non intégrés au chiffre d'affaires SODATRA
- Montants définitifs après liquidation GAINDE

Pour un calcul exact, merci de préciser :
1. Nature exacte de la marchandise
2. Code SH (si connu)
3. Pays d'origine (pour accords préférentiels éventuels)`;
  }

  return `Merci pour votre message. Pour vous fournir une cotation précise et conforme à la méthodologie SODATRA, j'ai besoin des informations suivantes :

**Informations minimales requises :**
1. **Incoterm** (FOB, CIF, EXW, DAP, DDP...)
2. **Mode de transport** (Maritime conteneur, RORO, Breakbulk, Aérien)
3. **Type de marchandise** (nature, code SH si disponible)
4. **Unité** (20', 40', poids/volume, nombre de colis)
5. **Port/aéroport d'origine**

**Structure de ma cotation :**
- Transport international
- Frais portuaires/aéroportuaires (PAD/AIBD)
- Manutention (DP World/Handling)
- Dédouanement (honoraires)
- Débours douaniers (estimation, refacturés à l'identique)
- Honoraires SODATRA

Je reste à votre disposition pour toute précision.`;
}

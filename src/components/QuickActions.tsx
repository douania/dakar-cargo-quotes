import { motion } from "framer-motion";
import { Ship, Plane, FileText, Calculator } from "lucide-react";

interface QuickActionsProps {
  onSelect: (prompt: string) => void;
}

const actions = [
  {
    icon: Ship,
    label: "Conteneur Import",
    prompt: "Je souhaite une cotation pour l'importation d'un conteneur 40' HC depuis Shanghai vers Dakar, en CIF. Marchandise générale.",
  },
  {
    icon: Plane,
    label: "Fret Aérien",
    prompt: "J'ai besoin d'une cotation pour un envoi aérien de 500 kg de marchandise depuis Paris CDG vers Dakar AIBD, en FOB.",
  },
  {
    icon: FileText,
    label: "Véhicule RORO",
    prompt: "Cotation pour l'importation d'un véhicule d'occasion depuis Anvers vers Dakar, mode RORO, en FOB.",
  },
  {
    icon: Calculator,
    label: "Débours Douaniers",
    prompt: "Pouvez-vous me détailler les débours douaniers pour une importation de marchandise générale d'une valeur CIF de 15 000 000 FCFA?",
  },
];

export function QuickActions({ onSelect }: QuickActionsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {actions.map((action, index) => (
        <motion.button
          key={action.label}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
          onClick={() => onSelect(action.prompt)}
          className="group flex flex-col items-center gap-3 p-4 rounded-xl bg-card border border-border hover:border-gold/50 hover:bg-muted/50 transition-all duration-300"
        >
          <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center group-hover:bg-gold/20 transition-colors">
            <action.icon className="w-5 h-5 text-ocean group-hover:text-gold transition-colors" />
          </div>
          <span className="text-sm font-medium text-foreground text-center">
            {action.label}
          </span>
        </motion.button>
      ))}
    </div>
  );
}

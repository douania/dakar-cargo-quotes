import { motion } from "framer-motion";
import { Anchor, Shield, Clock, CheckCircle2 } from "lucide-react";

export function WelcomeSection() {
  const features = [
    { icon: Shield, text: "Tarifs officiels PAD & DP World" },
    { icon: Clock, text: "Cotations en temps réel" },
    { icon: CheckCircle2, text: "Incoterms® 2020 appliqués" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="text-center py-8"
    >
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-gold shadow-glow mb-6">
        <Anchor className="w-10 h-10 text-primary-foreground" />
      </div>
      
      <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-3">
        Agent de Cotation <span className="text-gradient-gold">Intelligent</span>
      </h2>
      
      <p className="text-muted-foreground max-w-xl mx-auto mb-8 leading-relaxed">
        Expert en cotation logistique maritime et aérienne pour le Sénégal.
        Port Autonome de Dakar · Douane GAINDE/ORBUS · Méthodologie SODATRA
      </p>

      <div className="flex flex-wrap items-center justify-center gap-4">
        {features.map((feature, index) => (
          <motion.div
            key={feature.text}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 + index * 0.1 }}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-border"
          >
            <feature.icon className="w-4 h-4 text-gold" />
            <span className="text-sm text-foreground">{feature.text}</span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

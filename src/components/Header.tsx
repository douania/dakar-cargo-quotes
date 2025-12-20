import { Ship, Plane, Anchor, MessageSquare, LayoutDashboard } from "lucide-react";
import { motion } from "framer-motion";
import { Link, useLocation } from "react-router-dom";

export function Header() {
  const location = useLocation();
  const isChat = location.pathname === "/chat";
  return (
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50"
    >
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-gold flex items-center justify-center shadow-glow">
                <Anchor className="w-6 h-6 text-primary-foreground" />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">
                SODATRA <span className="text-gradient-gold">Cotation</span>
              </h1>
              <p className="text-xs text-muted-foreground">
                Agent IA Expert · Port de Dakar
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Ship className="w-4 h-4 text-ocean" />
              <span>Maritime</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Plane className="w-4 h-4 text-ocean" />
              <span>Aérien</span>
            </div>
            
            <Link 
              to={isChat ? "/" : "/chat"}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
            >
              {isChat ? (
                <>
                  <LayoutDashboard className="w-4 h-4" />
                  <span className="text-sm font-medium">Dashboard</span>
                </>
              ) : (
                <>
                  <MessageSquare className="w-4 h-4" />
                  <span className="text-sm font-medium">Chat IA</span>
                </>
              )}
            </Link>
            
            <div className="px-3 py-1.5 rounded-full bg-success/20 text-success text-xs font-medium">
              En ligne
            </div>
          </div>
        </div>
      </div>
    </motion.header>
  );
}

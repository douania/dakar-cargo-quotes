-- Améliorer learned_knowledge pour distinguer les types
ALTER TABLE learned_knowledge ADD COLUMN IF NOT EXISTS 
  knowledge_type VARCHAR(20) DEFAULT 'historical';

ALTER TABLE learned_knowledge ADD COLUMN IF NOT EXISTS 
  valid_until TIMESTAMP;

ALTER TABLE learned_knowledge ADD COLUMN IF NOT EXISTS 
  matching_criteria JSONB;

-- Index pour recherche rapide
CREATE INDEX IF NOT EXISTS idx_learned_knowledge_type ON learned_knowledge(knowledge_type);
CREATE INDEX IF NOT EXISTS idx_learned_knowledge_category_type ON learned_knowledge(category, knowledge_type);
CREATE INDEX IF NOT EXISTS idx_learned_knowledge_matching ON learned_knowledge USING GIN(matching_criteria);

-- Ajouter colonnes de traçabilité à quotation_history
ALTER TABLE quotation_history ADD COLUMN IF NOT EXISTS 
  quotation_lines JSONB;

ALTER TABLE quotation_history ADD COLUMN IF NOT EXISTS 
  was_accepted BOOLEAN DEFAULT NULL;

ALTER TABLE quotation_history ADD COLUMN IF NOT EXISTS 
  source_breakdown JSONB;

-- Index pour recherche historique
CREATE INDEX IF NOT EXISTS idx_quotation_history_route ON quotation_history(route_destination, cargo_type);
CREATE INDEX IF NOT EXISTS idx_quotation_history_date ON quotation_history(created_at DESC);
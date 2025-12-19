import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import HsCodesAdmin from "./pages/admin/HsCodes";
import TaxRatesAdmin from "./pages/admin/TaxRates";
import DocumentsAdmin from "./pages/admin/Documents";
import EmailsAdmin from "./pages/admin/Emails";
import KnowledgeAdmin from "./pages/admin/Knowledge";
import MarketIntelligence from "./pages/admin/MarketIntelligence";
import CustomsRegimesAdmin from "./pages/admin/CustomsRegimes";
import PricingIntelligence from "./pages/admin/PricingIntelligence";
import PortTariffsAdmin from "./pages/admin/PortTariffs";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/admin/hs-codes" element={<HsCodesAdmin />} />
          <Route path="/admin/tax-rates" element={<TaxRatesAdmin />} />
          <Route path="/admin/customs-regimes" element={<CustomsRegimesAdmin />} />
          <Route path="/admin/documents" element={<DocumentsAdmin />} />
          <Route path="/admin/emails" element={<EmailsAdmin />} />
          <Route path="/admin/knowledge" element={<KnowledgeAdmin />} />
          <Route path="/admin/market-intelligence" element={<MarketIntelligence />} />
          <Route path="/admin/pricing-intelligence" element={<PricingIntelligence />} />
          <Route path="/admin/tarifs-portuaires" element={<PortTariffsAdmin />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

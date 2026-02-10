import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";

// Auth
import { AuthProvider, RequireAuth } from "@/features/auth";

// Pages
import LoginPage from "./pages/LoginPage";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Dashboard from "./pages/Dashboard";
import QuotationSheet from "./pages/QuotationSheet";
import HsCodesAdmin from "./pages/admin/HsCodes";
import TaxRatesAdmin from "./pages/admin/TaxRates";
import DocumentsAdmin from "./pages/admin/Documents";
import EmailsAdmin from "./pages/admin/Emails";
import KnowledgeAdmin from "./pages/admin/Knowledge";
import MarketIntelligence from "./pages/admin/MarketIntelligence";
import CustomsRegimesAdmin from "./pages/admin/CustomsRegimes";
import PricingIntelligence from "./pages/admin/PricingIntelligence";
import PortTariffsAdmin from "./pages/admin/PortTariffs";
import TruckLoading from "./pages/TruckLoading";
import Intake from "./pages/Intake";
import CaseView from "./pages/CaseView";
import TariffReports from "./pages/admin/TariffReports";
import TendersAdmin from "./pages/admin/Tenders";
import TransportRates from "./pages/admin/TransportRates";
import QuotationHistory from "./pages/admin/QuotationHistory";
import ClientOverrides from "./pages/admin/ClientOverrides";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Route publique - Login */}
            <Route path="/login" element={<LoginPage />} />

            {/* Routes protégées */}
            <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="/chat" element={<RequireAuth><Index /></RequireAuth>} />
            <Route path="/quotation/new" element={<RequireAuth><QuotationSheet /></RequireAuth>} />
            <Route path="/quotation/:emailId" element={<RequireAuth><QuotationSheet /></RequireAuth>} />
            <Route path="/admin/hs-codes" element={<RequireAuth><HsCodesAdmin /></RequireAuth>} />
            <Route path="/admin/tax-rates" element={<RequireAuth><TaxRatesAdmin /></RequireAuth>} />
            <Route path="/admin/customs-regimes" element={<RequireAuth><CustomsRegimesAdmin /></RequireAuth>} />
            <Route path="/admin/documents" element={<RequireAuth><DocumentsAdmin /></RequireAuth>} />
            <Route path="/admin/emails" element={<RequireAuth><EmailsAdmin /></RequireAuth>} />
            <Route path="/admin/knowledge" element={<RequireAuth><KnowledgeAdmin /></RequireAuth>} />
            <Route path="/admin/market-intelligence" element={<RequireAuth><MarketIntelligence /></RequireAuth>} />
            <Route path="/admin/pricing-intelligence" element={<RequireAuth><PricingIntelligence /></RequireAuth>} />
            <Route path="/admin/tarifs-portuaires" element={<RequireAuth><PortTariffsAdmin /></RequireAuth>} />
            <Route path="/admin/tariff-reports" element={<RequireAuth><TariffReports /></RequireAuth>} />
            <Route path="/admin/tenders" element={<RequireAuth><TendersAdmin /></RequireAuth>} />
            <Route path="/admin/transport-rates" element={<RequireAuth><TransportRates /></RequireAuth>} />
            <Route path="/admin/quotation-history" element={<RequireAuth><QuotationHistory /></RequireAuth>} />
            <Route path="/admin/client-overrides" element={<RequireAuth><ClientOverrides /></RequireAuth>} />
            <Route path="/truck-loading" element={<RequireAuth><TruckLoading /></RequireAuth>} />
            <Route path="/intake" element={<RequireAuth><Intake /></RequireAuth>} />
            <Route path="/case/:caseId" element={<RequireAuth><CaseView /></RequireAuth>} />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;

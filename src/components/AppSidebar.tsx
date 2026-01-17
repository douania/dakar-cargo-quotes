import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  MessageSquare, 
  Settings, 
  FileText,
  Package,
  DollarSign,
  Ship,
  BookOpen,
  Mail,
  Brain,
  BarChart3,
  ChevronDown,
  Anchor,
  Search,
  Truck
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { KnowledgeSearch } from '@/components/KnowledgeSearch';

const mainNavItems = [
  { 
    title: 'Demandes à traiter', 
    url: '/', 
    icon: LayoutDashboard,
    description: 'Cotations en attente'
  },
  { 
    title: 'Chat IA', 
    url: '/chat', 
    icon: MessageSquare,
    description: 'Questions & recherches'
  },
  { 
    title: 'Optimisation Chargement', 
    url: '/truck-loading', 
    icon: Truck,
    description: 'Planification chargement camions'
  },
];

import { TrendingUp, Briefcase, History } from 'lucide-react';

const adminItems = [
  { title: 'Emails', url: '/admin/emails', icon: Mail },
  { title: 'Tenders', url: '/admin/tenders', icon: Briefcase },
  { title: 'Historique cotations', url: '/admin/quotation-history', icon: History },
  { title: 'Connaissances', url: '/admin/knowledge', icon: Brain },
  { title: 'Rapports tarifs', url: '/admin/tariff-report', icon: TrendingUp },
  { title: 'Codes SH', url: '/admin/hs-codes', icon: Package },
  { title: 'Taux & Taxes', url: '/admin/tax-rates', icon: DollarSign },
  { title: 'Régimes douaniers', url: '/admin/customs-regimes', icon: FileText },
  { title: 'Tarifs portuaires', url: '/admin/tarifs-portuaires', icon: Ship },
  { title: 'Documents', url: '/admin/documents', icon: BookOpen },
  { title: 'Intelligence marché', url: '/admin/market-intelligence', icon: BarChart3 },
  { title: 'Intelligence prix', url: '/admin/pricing-intelligence', icon: DollarSign },
];

export function AppSidebar() {
  const location = useLocation();
  const { state } = useSidebar();
  const isCollapsed = state === 'collapsed';
  
  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const isAdminActive = adminItems.some(item => isActive(item.url));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link to="/" className="flex items-center gap-3 px-2 py-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-gold flex items-center justify-center shadow-glow shrink-0">
            <Anchor className="w-5 h-5 text-primary-foreground" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col">
              <span className="font-bold text-foreground tracking-tight">SODATRA</span>
              <span className="text-xs text-muted-foreground">Assistant Cotation</span>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {/* Global Search */}
        {!isCollapsed && (
          <SidebarGroup>
            <SidebarGroupContent className="px-2">
              <KnowledgeSearch />
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        
        {isCollapsed && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <KnowledgeSearch 
                    triggerButton={
                      <SidebarMenuButton tooltip="Rechercher (⌘K)">
                        <Search className="h-4 w-4" />
                        <span>Rechercher</span>
                      </SidebarMenuButton>
                    }
                  />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Main Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton 
                    asChild
                    isActive={isActive(item.url)}
                    tooltip={item.title}
                  >
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Administration - Collapsible */}
        <SidebarGroup>
          <Collapsible defaultOpen={isAdminActive}>
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="cursor-pointer hover:bg-sidebar-accent rounded-md transition-colors flex items-center justify-between pr-2">
                <span className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  {!isCollapsed && <span>Administration</span>}
                </span>
                {!isCollapsed && <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />}
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {adminItems.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton 
                        asChild
                        isActive={isActive(item.url)}
                        tooltip={item.title}
                      >
                        <Link to={item.url}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            {!isCollapsed && (
              <span className="text-xs text-muted-foreground">Système en ligne</span>
            )}
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
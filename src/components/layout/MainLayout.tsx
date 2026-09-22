import { SidebarProvider, SidebarTrigger, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <SidebarProvider>
      <div className="flex h-svh w-full overflow-hidden" data-print-layout="root">
        <AppSidebar />
        <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col" data-print-layout="inset">
          <header className="h-12 flex items-center border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50 px-4">
            <SidebarTrigger className="mr-4" />
            <div className="flex-1" />
            <div className="px-3 py-1 rounded-full bg-green-500/20 text-green-500 text-xs font-medium">
              En ligne
            </div>
          </header>
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-visible" data-print-layout="content">
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
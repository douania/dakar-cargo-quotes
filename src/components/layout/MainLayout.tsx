import { forwardRef } from 'react';
import { SidebarProvider, SidebarTrigger, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';

interface MainLayoutProps {
  children: React.ReactNode;
}

export const MainLayout = forwardRef<HTMLDivElement, MainLayoutProps>(
  function MainLayout({ children }, ref) {
    return (
      <SidebarProvider>
        <div ref={ref} className="min-h-screen flex w-full">
          <AppSidebar />
          <SidebarInset className="flex flex-col flex-1">
            <header className="h-12 flex items-center border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50 px-4">
              <SidebarTrigger className="mr-4" />
              <div className="flex-1" />
              <div className="px-3 py-1 rounded-full bg-green-500/20 text-green-500 text-xs font-medium">
                En ligne
              </div>
            </header>
            <main className="flex-1 overflow-auto">
              {children}
            </main>
          </SidebarInset>
        </div>
      </SidebarProvider>
    );
  }
);
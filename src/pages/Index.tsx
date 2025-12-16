import { Header } from "@/components/Header";
import { ChatInterface } from "@/components/ChatInterface";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <ChatInterface />
      </main>
    </div>
  );
};

export default Index;

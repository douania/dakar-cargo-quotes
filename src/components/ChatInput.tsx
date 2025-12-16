import { useState, useRef, useEffect } from "react";
import { Send, Paperclip } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, isLoading, placeholder = "Décrivez votre demande de cotation..." }: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSend(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="flex items-end gap-2 p-3 bg-card border border-border rounded-2xl shadow-card focus-within:ring-2 focus-within:ring-gold/30 transition-all">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isLoading}
          rows={1}
          className={cn(
            "flex-1 resize-none bg-transparent text-foreground placeholder:text-muted-foreground",
            "focus:outline-none text-sm leading-relaxed py-2 px-1",
            "scrollbar-thin max-h-[200px]"
          )}
        />
        
        <div className="flex items-center gap-2">
          <Button
            type="submit"
            variant="gold"
            size="icon"
            disabled={!input.trim() || isLoading}
            className="h-10 w-10 rounded-xl"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-2 text-center">
        Précisez l'Incoterm, le mode de transport, la marchandise et le port d'origine pour une cotation exacte.
      </p>
    </form>
  );
}

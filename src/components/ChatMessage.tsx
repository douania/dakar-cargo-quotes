import { motion } from "framer-motion";
import { Bot, User, Copy, Check, FileText } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

interface AttachedFile {
  id: string;
  name: string;
  content: string;
}

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isLoading?: boolean;
  attachedFiles?: AttachedFile[];
}

export function ChatMessage({ role, content, isLoading, attachedFiles }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const isAssistant = role === "assistant";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "flex gap-4 p-4 rounded-xl group",
        isAssistant ? "bg-card/50" : "bg-transparent"
      )}
    >
      <div
        className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
          isAssistant
            ? "bg-gradient-gold shadow-glow"
            : "bg-secondary"
        )}
      >
        {isAssistant ? (
          <Bot className="w-5 h-5 text-primary-foreground" />
        ) : (
          <User className="w-5 h-5 text-secondary-foreground" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-foreground">
            {isAssistant ? "Agent SODATRA" : "Vous"}
          </span>
          {isAssistant && !isLoading && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="w-3 h-3 text-success" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </Button>
          )}
        </div>

        {attachedFiles && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachedFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-1 px-2 py-1 bg-gold/10 border border-gold/20 rounded-md text-xs text-gold"
              >
                <FileText className="w-3 h-3" />
                <span className="max-w-[150px] truncate">{file.name}</span>
              </div>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse" style={{ animationDelay: "0.2s" }} />
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse" style={{ animationDelay: "0.4s" }} />
          </div>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            <div className="text-foreground/90 whitespace-pre-wrap leading-relaxed">
              {content}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

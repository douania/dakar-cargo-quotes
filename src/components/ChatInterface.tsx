import { useRef, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { QuickActions } from "./QuickActions";
import { WelcomeSection } from "./WelcomeSection";
import { useChat } from "@/hooks/useChat";
import type { AttachedFile } from "@/types";

export function ChatInterface() {
  const { messages, isLoading, sendMessage } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback((content: string, attachedFiles?: AttachedFile[]) => {
    sendMessage(content, attachedFiles);
  }, [sendMessage]);

  const handleQuickAction = useCallback((prompt: string) => {
    sendMessage(prompt);
  }, [sendMessage]);

  // Memoize message list to prevent unnecessary re-renders
  const messageList = useMemo(() => (
    messages.map((message) => (
      <ChatMessage
        key={message.id}
        role={message.role}
        content={message.content}
        attachedFiles={message.attachedFiles}
      />
    ))
  ), [messages]);

  // Memoize loading indicator condition
  const showLoadingIndicator = useMemo(() => 
    isLoading && messages[messages.length - 1]?.role !== "assistant",
    [isLoading, messages]
  );

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto scrollbar-thin px-4 py-6"
      >
        <div className="max-w-3xl mx-auto">
          <AnimatePresence mode="wait">
            {messages.length === 0 ? (
              <motion.div
                key="welcome"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <WelcomeSection />
                <div className="mt-8">
                  <p className="text-sm text-muted-foreground mb-4 text-center">
                    Commencez par une action rapide ou décrivez votre besoin
                  </p>
                  <QuickActions onSelect={handleQuickAction} />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="chat"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-2"
              >
                {messageList}
                {showLoadingIndicator && (
                  <ChatMessage role="assistant" content="" isLoading />
                )}
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-border bg-background/80 backdrop-blur-sm p-4">
        <div className="max-w-3xl mx-auto">
          <ChatInput onSend={handleSend} isLoading={isLoading} />
        </div>
      </div>
    </div>
  );
}

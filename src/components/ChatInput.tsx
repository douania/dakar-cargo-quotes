import { useState, useRef, useEffect } from "react";
import { Send, Paperclip, X, FileText, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AttachedFile {
  id: string;
  name: string;
  content: string;
}

interface ChatInputProps {
  onSend: (message: string, attachedFiles?: AttachedFile[]) => void;
  isLoading: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, isLoading, placeholder = "Décrivez votre demande de cotation..." }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    
    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append('file', file);

        const { data, error } = await supabase.functions.invoke('parse-document', {
          body: formData,
        });

        if (error) throw error;

        const newFile: AttachedFile = {
          id: data.documentId || Date.now().toString(),
          name: file.name,
          content: data.content || '',
        };

        setAttachedFiles(prev => [...prev, newFile]);
        toast.success(`${file.name} ajouté`);
      } catch (error) {
        console.error('Upload error:', error);
        toast.error(`Erreur lors de l'upload de ${file.name}`);
      }
    }

    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (id: string) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachedFiles.length === 0) || isLoading || isUploading) return;
    onSend(input.trim(), attachedFiles.length > 0 ? attachedFiles : undefined);
    setInput("");
    setAttachedFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 p-2 bg-muted/50 rounded-lg">
          {attachedFiles.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-1 px-2 py-1 bg-background border border-border rounded-md text-xs"
            >
              <FileText className="w-3 h-3 text-gold" />
              <span className="max-w-[150px] truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(file.id)}
                className="ml-1 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 p-3 bg-card border border-border rounded-2xl shadow-card focus-within:ring-2 focus-within:ring-gold/30 transition-all">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          onChange={handleFileUpload}
          className="hidden"
        />
        
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading || isUploading}
          className="h-10 w-10 rounded-xl text-muted-foreground hover:text-foreground"
        >
          {isUploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Paperclip className="w-4 h-4" />
          )}
        </Button>

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
            disabled={(!input.trim() && attachedFiles.length === 0) || isLoading || isUploading}
            className="h-10 w-10 rounded-xl"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-2 text-center">
        📎 Joignez des documents (PDF, Excel, CSV) pour les analyser • Précisez Incoterm, transport, marchandise et origine
      </p>
    </form>
  );
}

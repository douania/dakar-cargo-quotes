// Shared AI client utilities

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
}

// Call Lovable AI gateway
export async function callAI(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<Response> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }

  const {
    model = "google/gemini-2.5-flash",
    stream = false,
    temperature,
    maxTokens,
  } = options;

  const body: Record<string, unknown> = {
    model,
    messages,
    stream,
  };

  if (temperature !== undefined) body.temperature = temperature;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;

  return fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// Parse non-streaming AI response
export async function parseAIResponse(response: Response): Promise<string> {
  if (!response.ok) {
    const errorText = await response.text();
    console.error("AI error:", response.status, errorText);
    throw new Error(`AI error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

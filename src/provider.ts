import Anthropic from "@anthropic-ai/sdk";
import OpenAI, { AzureOpenAI } from "openai";

export type Provider = "anthropic" | "openai" | "azure";

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
  signal: AbortSignal;
}

/** Provider-agnostic chat client: one system + one user message in, text out. */
export interface LlmClient {
  /** Human-readable provider label, for messages and errors. */
  readonly label: string;
  complete(req: CompletionRequest): Promise<string>;
}

export interface LlmOptions {
  provider: Provider;
  model: string;
  /** May be empty for local OpenAI-compatible servers that need no key. */
  apiKey: string;
  /** OpenAI-compatible base URL (e.g. http://localhost:11434/v1 for Ollama). */
  baseUrl?: string;
  /** Azure OpenAI resource endpoint, e.g. https://my-res.openai.azure.com */
  azureEndpoint?: string;
  /** Azure OpenAI api-version, e.g. 2024-10-21. */
  azureApiVersion?: string;
}

export function createLlmClient(opts: LlmOptions): LlmClient {
  if (opts.provider === "anthropic") {
    return new AnthropicLlmClient(opts.apiKey, opts.model);
  }
  if (opts.provider === "azure") {
    return new AzureOpenAiLlmClient(
      opts.apiKey,
      opts.model,
      opts.azureEndpoint,
      opts.azureApiVersion
    );
  }
  return new OpenAiLlmClient(opts.apiKey, opts.model, opts.baseUrl);
}

/**
 * Resolve the model id, falling back to a provider default when unset.
 * Throws when there is no safe default (local endpoints, Azure deployments).
 */
export function resolveModel(provider: Provider, model: string, baseUrl: string): string {
  if (provider === "azure") {
    if (model) {
      return model;
    }
    throw new Error("set 'adrAi.model' to your Azure OpenAI deployment name.");
  }
  if (model) {
    return model;
  }
  if (provider === "anthropic") {
    return "claude-opus-4-8";
  }
  if (baseUrl) {
    throw new Error(
      "set 'adrAi.model' to your local model name (e.g. \"llama3.1\" or \"qwen2.5-coder\")."
    );
  }
  return "gpt-4o";
}

class AnthropicLlmClient implements LlmClient {
  readonly label = "Anthropic";
  private readonly client: Anthropic;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(req: CompletionRequest): Promise<string> {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }]
      },
      { signal: req.signal }
    );
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
}

class OpenAiLlmClient implements LlmClient {
  readonly label: string;
  private readonly client: OpenAI;

  constructor(apiKey: string, private readonly model: string, baseUrl?: string) {
    // The SDK requires a non-empty key; local servers ignore it.
    this.client = new OpenAI({ apiKey: apiKey || "local", baseURL: baseUrl || undefined });
    this.label = baseUrl ? `OpenAI-compatible (${baseUrl})` : "OpenAI";
  }

  complete(req: CompletionRequest): Promise<string> {
    return chatComplete(this.client, this.model, req);
  }
}

class AzureOpenAiLlmClient implements LlmClient {
  readonly label = "Azure OpenAI";
  private readonly client: AzureOpenAI;

  constructor(apiKey: string, private readonly deployment: string, endpoint?: string, apiVersion?: string) {
    if (!endpoint) {
      throw new Error("set 'adrAi.azureEndpoint' (e.g. https://<resource>.openai.azure.com).");
    }
    if (!apiVersion) {
      throw new Error("set 'adrAi.azureApiVersion' (e.g. 2024-10-21).");
    }
    this.client = new AzureOpenAI({ apiKey, endpoint, apiVersion, deployment });
  }

  complete(req: CompletionRequest): Promise<string> {
    // With `deployment` set on the client, routing uses it; `model` is sent
    // for completeness (the deployment name) but does not affect routing.
    return chatComplete(this.client, this.deployment, req);
  }
}

/** Shared OpenAI-style chat completion, with a retry for reasoning models. */
async function chatComplete(
  client: OpenAI,
  model: string,
  req: CompletionRequest
): Promise<string> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: req.system },
    { role: "user", content: req.user }
  ];

  try {
    const response = await client.chat.completions.create(
      { model, max_tokens: req.maxTokens, messages },
      { signal: req.signal }
    );
    return response.choices[0]?.message?.content ?? "";
  } catch (err) {
    // Newer OpenAI reasoning models reject `max_tokens` and require
    // `max_completion_tokens`. Retry once with the alternate parameter.
    if (!requiresCompletionTokensParam(err)) {
      throw err;
    }
    const response = await client.chat.completions.create(
      { model, max_completion_tokens: req.maxTokens, messages },
      { signal: req.signal }
    );
    return response.choices[0]?.message?.content ?? "";
  }
}

function requiresCompletionTokensParam(err: unknown): boolean {
  const message = (err as { message?: string }).message?.toLowerCase() ?? "";
  return message.includes("max_completion_tokens");
}

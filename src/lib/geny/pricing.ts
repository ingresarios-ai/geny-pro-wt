export interface AiPricingConfig {
  gemini_input_per_1m: number;
  gemini_audio_input_per_1m: number;
  gemini_output_per_1m: number;
  gemini_embedding_per_1m: number;
  claude_sonnet_input_per_1m: number;
  claude_sonnet_cached_per_1m: number;
  claude_sonnet_output_per_1m: number;
  claude_haiku_input_per_1m: number;
  claude_haiku_output_per_1m: number;
  whisper_note_flat_usd: number;
}

export const DEFAULT_AI_PRICING: AiPricingConfig = {
  gemini_input_per_1m: 0.3,
  gemini_audio_input_per_1m: 1.0,
  gemini_output_per_1m: 2.5,
  gemini_embedding_per_1m: 0.15,
  claude_sonnet_input_per_1m: 3.0,
  claude_sonnet_cached_per_1m: 0.3,
  claude_sonnet_output_per_1m: 15.0,
  claude_haiku_input_per_1m: 0.8,
  claude_haiku_output_per_1m: 4.0,
  whisper_note_flat_usd: 0.001,
};

export function resolveAiPricing(
  overrides?: Partial<AiPricingConfig> | null
): AiPricingConfig {
  if (!overrides) return { ...DEFAULT_AI_PRICING };
  const merged = { ...DEFAULT_AI_PRICING };
  (Object.keys(DEFAULT_AI_PRICING) as Array<keyof AiPricingConfig>).forEach(
    (k) => {
      const val = Number(overrides[k]);
      if (Number.isFinite(val) && val >= 0) {
        merged[k] = val;
      }
    }
  );
  return merged;
}

export function calculateMessageCostUsd(params: {
  provider: "gemini" | "claude";
  modelId: string;
  inputType: "text" | "audio" | "image";
  tokensIn: number;
  tokensOut: number;
  thoughtsTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  pricingOverrides?: Partial<AiPricingConfig> | null;
}): number {
  const rates = resolveAiPricing(params.pricingOverrides);
  const modelLower = params.modelId.toLowerCase();
  const inTok = Math.max(0, params.tokensIn);
  const outTok = Math.max(0, params.tokensOut);
  const thinkTok = Math.max(0, params.thoughtsTokens ?? 0);
  const cachedTok = Math.max(0, params.cachedInputTokens ?? 0);
  const cacheWriteTok = Math.max(0, params.cacheWriteTokens ?? 0);

  // Pequeño costo de búsqueda vectorial RAG (~80 tokens en gemini-embedding-001)
  const ragSearchUsd = (80 * rates.gemini_embedding_per_1m) / 1_000_000;

  if (params.provider === "claude") {
    const isHaiku = modelLower.includes("haiku");
    const baseInRate = isHaiku
      ? rates.claude_haiku_input_per_1m
      : rates.claude_sonnet_input_per_1m;
    const cachedRate = isHaiku
      ? rates.claude_haiku_input_per_1m * 0.1
      : rates.claude_sonnet_cached_per_1m;
    const outRate = isHaiku
      ? rates.claude_haiku_output_per_1m
      : rates.claude_sonnet_output_per_1m;

    const nonCachedIn = Math.max(0, inTok - cachedTok - cacheWriteTok);
    const inputUsd =
      (nonCachedIn * baseInRate +
        cachedTok * cachedRate +
        cacheWriteTok * baseInRate * 1.25) /
      1_000_000;
    const outputUsd = ((outTok + thinkTok) * outRate) / 1_000_000;
    const whisperUsd =
      params.inputType === "audio" ? rates.whisper_note_flat_usd : 0;

    return Number((inputUsd + outputUsd + whisperUsd + ragSearchUsd).toFixed(6));
  }

  // Proveedor Gemini
  if (modelLower.includes("lite")) {
    const liteUsd = (inTok * 0.1 + (outTok + thinkTok) * 0.4) / 1_000_000;
    return Number((liteUsd + ragSearchUsd).toFixed(6));
  }

  const geminiInRate =
    params.inputType === "audio"
      ? rates.gemini_audio_input_per_1m
      : rates.gemini_input_per_1m;

  const geminiUsd =
    (inTok * geminiInRate + (outTok + thinkTok) * rates.gemini_output_per_1m) /
    1_000_000;

  return Number((geminiUsd + ragSearchUsd).toFixed(6));
}

export function estimateRagExtractionCostUsd(params: {
  tokensIn: number;
  tokensOut: number;
  embeddingChars?: number;
  pricingOverrides?: Partial<AiPricingConfig> | null;
}): number {
  const rates = resolveAiPricing(params.pricingOverrides);
  const llmUsd =
    (Math.max(0, params.tokensIn) * rates.gemini_input_per_1m +
      Math.max(0, params.tokensOut) * rates.gemini_output_per_1m) /
    1_000_000;
  const approxEmbedTokens = Math.ceil((params.embeddingChars ?? 0) / 4);
  const embedUsd =
    (approxEmbedTokens * rates.gemini_embedding_per_1m) / 1_000_000;
  return Number((llmUsd + embedUsd).toFixed(6));
}


import { generateText, CoreMessage, UserContent } from "ai";
import { google } from "@ai-sdk/google";
import { anthropic } from "@ai-sdk/anthropic";
import {
  ChannelType,
  GenySettings,
  GenyUser,
  getSupabaseAdmin,
} from "@/lib/supabase/admin";
import { evaluateGuardrails } from "@/lib/geny/guardrails";
import { extractReferenceUrls, searchKnowledgeContext } from "@/lib/geny/rag";
import { calculateMessageCostUsd } from "@/lib/geny/pricing";

export interface BrainInput {
  user: GenyUser;
  settings: GenySettings;
  channel: ChannelType;
  inputType: "text" | "audio" | "image";
  text?: string;
  mediaBuffer?: Buffer;
  mediaMimeType?: string;
}

export interface BrainOutput {
  replyText: string;
  providerUsed: string;
  modelUsed: string;
  needsHumanReview: boolean;
}

async function transcribeAudioWithWhisper(
  audioBuffer: Buffer,
  mimeType: string,
  preferredProvider: "openai" | "groq"
): Promise<string> {
  const useGroq =
    preferredProvider === "groq" && Boolean(process.env.GROQ_API_KEY);
  const apiKey = useGroq
    ? process.env.GROQ_API_KEY
    : process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Para transcribir notas de voz con Claude necesitas configurar GROQ_API_KEY u OPENAI_API_KEY."
    );
  }

  const endpoint =
    useGroq || (!process.env.OPENAI_API_KEY && Boolean(process.env.GROQ_API_KEY))
      ? "https://api.groq.com/openai/v1/audio/transcriptions"
      : "https://api.openai.com/v1/audio/transcriptions";

  const modelName = endpoint.includes("groq.com")
    ? "whisper-large-v3-turbo"
    : "whisper-1";

  const ext = mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mp4") || mimeType.includes("m4a")
      ? "m4a"
      : "mp3";

  const form = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
  form.append("file", blob, `nota-voz.${ext}`);
  form.append("model", modelName);
  form.append("language", "es");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error en transcripción Whisper: ${errText}`);
  }

  const data = (await res.json()) as { text?: string };
  return (data.text || "").trim();
}

export async function runGenyBrain(input: BrainInput): Promise<BrainOutput> {
  const startedAt = Date.now();
  const supabase = getSupabaseAdmin();
  const { user, settings, channel, inputType } = input;

  let effectiveUserText = (input.text || "").trim();

  // 1. Si llega audio y el motor activo es Claude (o si queremos texto limpio para auditoría cuando hay Whisper disponible)
  const provider = settings.active_provider;
  if (inputType === "audio" && input.mediaBuffer && input.mediaMimeType) {
    if (
      provider === "claude" ||
      Boolean(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY)
    ) {
      effectiveUserText = await transcribeAudioWithWhisper(
        input.mediaBuffer,
        input.mediaMimeType,
        settings.whisper_provider
      );
    } else if (!effectiveUserText) {
      effectiveUserText = "[Nota de voz del alumno]";
    }
  }

  if (inputType === "image" && !effectiveUserText) {
    effectiveUserText =
      "Analiza de forma educativa este gráfico según la metodología de INGRESARIOS (sin dar señales de entrada/salida, ayúdame a observar estructura, contexto y mi plan).";
  }

  // 2. Evaluar Guardrails y Human Handoff obligatorio de Meta
  const guardrail = evaluateGuardrails(effectiveUserText);
  if (guardrail.isHumanHandoffRequest) {
    const handoffReply =
      `Con gusto te conecto con el equipo humano de **INGRESARIOS** 💜.\n\n` +
      `Escríbenos directamente aquí para atenderte de forma personalizada:\n${settings.human_support_url}`;

    await supabase.from("geny_messages").insert({
      user_id: user.id,
      channel,
      input_type: inputType,
      user_message: effectiveUserText,
      assistant_response: handoffReply,
      provider_used: "system-handoff",
      model_used: "guardrail",
      needs_human_review: true,
      review_reason: guardrail.reviewReason,
      latency_ms: Date.now() - startedAt,
    });

    return {
      replyText: handoffReply,
      providerUsed: "system-handoff",
      modelUsed: "guardrail",
      needsHumanReview: true,
    };
  }

  // 3. Cargar memoria reciente (últimos 10 turnos) y contexto RAG de INGRESARIOS en paralelo
  const [historyRes, ragChunks] = await Promise.all([
    supabase
      .from("geny_messages")
      .select("user_message, assistant_response")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10),
    searchKnowledgeContext(effectiveUserText, 5),
  ]);

  const recentTurns = (historyRes.data || []).reverse();

  const hasReferenceLinks = ragChunks.some(
    (c) => extractReferenceUrls(c.content).length > 0
  );

  const referenceLinksDirective = hasReferenceLinks
    ? `\n\n--- INSTRUCCIÓN DE REPETICIÓN DE SESIÓN Y ENLACES DE REFERENCIA ---\n` +
      `1. Si tu respuesta utiliza información de algún fragmento anterior que incluya un enlace de acceso, grabación o referencia (por ejemplo https://tinyurl.com/Pre..., https://tinyurl.com/Ent..., https://tinyurl.com/Pos..., Zoom, YouTube, Vimeo o script oficial de TradingView), invita de forma natural al alumno a ver la repetición de esa sesión (mencionando la sesión y su fecha, ej. "Premarket del 25/09/2026" o "Entrenamiento del 03/11/2026") compartiendo el enlace EXACTO.\n` +
      `2. Escribe la URL en texto plano limpio (ej. https://tinyurl.com/Pre2026-09-25), SIN encerrarla en comillas invertidas (\` \`) ni corchetes, para que el alumno pueda abrirla con un toque desde su celular.\n` +
      `3. Incluye únicamente el enlace (máximo 1 o 2) que corresponda directamente al tema consultado. JAMÁS inventes, completes ni modifiques una URL que no aparezca literalmente en los fragmentos anteriores.`
    : "";

  const knowledgeBlock =
    ragChunks.length > 0
      ? `\n\n--- BASE DE CONOCIMIENTO OFICIAL INGRESARIOS (Usa esto con prioridad) ---\n` +
        ragChunks
          .map(
            (c, idx) =>
              `[Fuente ${idx + 1}: ${c.document_title} (${c.category})]\n${c.content}`
          )
          .join("\n\n") +
        referenceLinksDirective
      : "";

  const studentContextBlock =
    `\n\n--- CONTEXTO DEL ALUMNO ---\n` +
    `Nombre: ${user.full_name || "Trader en formación"}\n` +
    `Plan: ${user.plan_tier}\n` +
    `Canal actual: ${channel === "web" ? "GENY PRO Web" : `${channel} (responde conciso y escaneable en celular, máx 250-350 palabras salvo que pida un plan detallado)`}\n` +
    (user.trader_profile_summary
      ? `Resumen evolutivo del alumno: ${user.trader_profile_summary}\n`
      : "");

  const fullSystemPrompt =
    settings.system_prompt_compliant + studentContextBlock + knowledgeBlock;

  const messages: CoreMessage[] = [];
  for (const turn of recentTurns) {
    messages.push({ role: "user", content: turn.user_message });
    messages.push({ role: "assistant", content: turn.assistant_response });
  }

  // Construir contenido multimodal del turno actual
  const userParts: UserContent = [];
  if (effectiveUserText) {
    userParts.push({ type: "text", text: effectiveUserText });
  }

  if (inputType === "image" && input.mediaBuffer && input.mediaMimeType) {
    userParts.push({
      type: "image",
      image: input.mediaBuffer,
      mimeType: input.mediaMimeType,
    });
  } else if (
    inputType === "audio" &&
    provider === "gemini" &&
    input.mediaBuffer &&
    input.mediaMimeType &&
    effectiveUserText === "[Nota de voz del alumno]"
  ) {
    // Gemini 3.8 Flash soporta audio nativo directo sin pasar por Whisper
    userParts.push({
      type: "file",
      data: input.mediaBuffer,
      mimeType: input.mediaMimeType,
    });
    userParts.push({
      type: "text",
      text: "Escucha esta nota de voz del alumno y respóndele como su mentora GENY PRO siguiendo estrictamente el protocolo GENY COMPLIANT.",
    });
  }

  messages.push({
    role: "user",
    content: userParts.length > 0 ? userParts : effectiveUserText,
  });

  // 4. Invocar el motor seleccionado (Gemini con cascada automática anti-caídas 429/503, o Claude con Prompt Caching)
  let modelId =
    provider === "claude" ? settings.claude_model : settings.gemini_model;

  let aiResult;
  if (provider === "claude") {
    aiResult = await generateText({
      model: anthropic(modelId),
      messages: [
        {
          role: "system",
          content: fullSystemPrompt,
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        },
        ...messages,
      ],
      maxTokens: 900,
      temperature: 0.45,
    });
  } else {
    const candidateModels = Array.from(
      new Set([
        settings.gemini_model,
        "gemini-3.8-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
      ])
    );

    let lastErr: unknown = null;
    for (const candidate of candidateModels) {
      try {
        modelId = candidate;
        aiResult = await generateText({
          model: google(candidate),
          system: fullSystemPrompt,
          messages,
          maxTokens: 4096,
          temperature: 0.45,
          maxRetries: 0,
          ...(candidate !== "gemini-3.5-flash-lite"
            ? {
                providerOptions: {
                  google: {
                    thinkingConfig: { thinkingBudget: 256 },
                  },
                },
              }
            : {}),
        });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`[GENY BRAIN FAILOVER] ${candidate} falló, probando siguiente modelo...`);
      }
    }

    if (!aiResult && lastErr) {
      throw lastErr;
    }
  }

  if (!aiResult) {
    throw new Error("No se obtuvo respuesta del modelo de IA.");
  }

  const replyText = aiResult.text
    .trim()
    .replace(/`(https?:\/\/[^\s`]+)`/gi, "$1");
  const latencyMs = Date.now() - startedAt;

  const tokensIn = aiResult.usage?.promptTokens ?? 0;
  const tokensOut = aiResult.usage?.completionTokens ?? 0;

  const googleUsage = (
    aiResult.providerMetadata?.google as
      | { usageMetadata?: { thoughtsTokenCount?: number } }
      | undefined
  )?.usageMetadata;
  const anthropicMeta = aiResult.providerMetadata?.anthropic as
    | {
        cacheReadInputTokens?: number;
        cacheCreationInputTokens?: number;
      }
    | undefined;

  const thoughtsTokens =
    provider === "gemini"
      ? (googleUsage?.thoughtsTokenCount ??
        (modelId.includes("lite") ? 0 : 256))
      : 0;
  const cachedInputTokens = anthropicMeta?.cacheReadInputTokens ?? 0;
  const cacheWriteTokens = anthropicMeta?.cacheCreationInputTokens ?? 0;

  const estimatedCostUsd = calculateMessageCostUsd({
    provider,
    modelId,
    inputType,
    tokensIn,
    tokensOut,
    thoughtsTokens,
    cachedInputTokens,
    cacheWriteTokens,
    pricingOverrides: settings.pricing_overrides,
  });

  // 5. Guardar mensaje + métricas + costo estimado USD + banderas de auditoría semanal + actualizar last_seen_at
  await Promise.all([
    supabase.from("geny_messages").insert({
      user_id: user.id,
      channel,
      input_type: inputType,
      user_message: effectiveUserText,
      assistant_response: replyText,
      provider_used: provider,
      model_used: modelId,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      thoughts_tokens: thoughtsTokens,
      cached_tokens: cachedInputTokens,
      estimated_cost_usd: estimatedCostUsd,
      latency_ms: latencyMs,
      needs_human_review: guardrail.needsHumanReview,
      review_reason: guardrail.reviewReason,
    }),
    supabase
      .from("geny_users")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", user.id),
  ]);

  return {
    replyText,
    providerUsed: provider,
    modelUsed: modelId,
    needsHumanReview: guardrail.needsHumanReview,
  };
}


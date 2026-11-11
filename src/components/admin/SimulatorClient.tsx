"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Send,
  Smartphone,
  ImagePlus,
  X,
  ShieldCheck,
  Info,
  Lock,
  Zap,
  RotateCcw,
} from "lucide-react";

interface ChatBubble {
  id: string;
  role: "user" | "assistant";
  text: string;
  meta?: string;
  devOtpHint?: string | null;
}

const QUICK_PROMPTS = [
  {
    label: "Evaluar Stop Loss con PEDEM",
    text: "Hola Geny, hoy moví mi stop loss por miedo, ¿cómo lo evalúo con PEDEM?",
  },
  {
    label: "Cash-Secured Put en La Rueda",
    text: "Explícame cómo seleccionar el Strike y Delta para vender un Cash-Secured Put en La Rueda.",
  },
  {
    label: "Confluencia Geny Trend + Sniper",
    text: "¿Cuál es el checklist exacto para validar una entrada con Geny Trend y Reditum Sniper?",
  },
  {
    label: "Probar Guardrail (Pedir Señal)",
    text: "Dime qué acción comprar hoy mismo para duplicar mi cuenta esta semana.",
  },
];

export default function SimulatorClient() {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [channel, setChannel] = useState<"whatsapp" | "telegram">("whatsapp");
  const [senderIdentifier, setSenderIdentifier] = useState("+573009998877");
  const [messageText, setMessageText] = useState("");
  const [attachedImage, setAttachedImage] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [bubbles, setBubbles] = useState<ChatBubble[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Terminal de simulación de GENY PRO activa.\n\nPuedes probar en tiempo real:\n1. Rechazo automático a no-miembros ($0 gasto de IA).\n2. Vinculación OTP real vía Resend (genypro@mail.ingresarios.net).\n3. Candado de 90 días al cambiar entre Dispositivo A y Dispositivo B.\n4. Respuestas de GENY PRO con RAG híbrido (PEDEM, La Rueda, Reditum Sniper, Geny Trend) o capturas de gráficos.",
      meta: "GENY PRO OS v2.6 · Entorno conectado a Supabase",
    },
  ]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending || (!messageText.trim() && !attachedImage)) return;

    const currentText = messageText;
    const currentImage = attachedImage;

    setBubbles((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        role: "user",
        text:
          currentText +
          (currentImage ? `\n[Imagen adjunta: ${currentImage.name}]` : ""),
        meta: `${channel.toUpperCase()} · ${senderIdentifier}`,
      },
    ]);
    setMessageText("");
    setAttachedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setSending(true);

    try {
      const fd = new FormData();
      fd.set("channel", channel);
      fd.set("senderIdentifier", senderIdentifier);
      fd.set("text", currentText);
      if (currentImage) {
        fd.set("image", currentImage);
      }

      const res = await fetch("/api/admin/simulator", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as {
        error?: string;
        allowed?: boolean;
        aiInvoked?: boolean;
        providerUsed?: string;
        modelUsed?: string;
        replyText?: string;
        devOtpHint?: string | null;
      };

      if (!res.ok) {
        setBubbles((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            text: json.error || "Error en la simulación.",
            meta: "Alerta de configuración",
          },
        ]);
      } else {
        setBubbles((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: json.replyText || "",
            meta: json.aiInvoked
              ? `GENY PRO IA (${json.providerUsed} · ${json.modelUsed})`
              : "Candado / Membresía ($0 tokens IA)",
            devOtpHint: json.devOtpHint,
          },
        ]);
      }
    } finally {
      setSending(false);
    }
  }

  // IME-safe Enter-to-submit (modern-web-guidance: ime-safe-enter-submit)
  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (e.nativeEvent.isComposing || e.keyCode === 229) {
        return;
      }
      formRef.current?.requestSubmit();
    }
  }

  return (
    <div className="min-h-screen bg-grid-pattern pb-12 text-slate-50">
      {/* Floating Glass Navbar (uiux-designer: top-4 spacing) */}
      <header className="sticky top-4 z-30 mx-auto max-w-7xl px-4 sm:px-6">
        <div className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-3.5">
          <div className="flex items-center gap-3.5">
            <Link
              href="/admin"
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 transition-colors duration-200 hover:border-white/25 hover:bg-white/[0.08]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Centro de Control</span>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-extrabold tracking-tight text-white sm:text-lg">
                  GENY PRO · Omnichannel Lab
                </h1>
                <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-emerald-300">
                  LIVE PIPELINE
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Simulación real contra Supabase, Resend OTP y Gemini 3.8 Flash
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              setBubbles([
                {
                  id: `reset-${Date.now()}`,
                  role: "assistant",
                  text: "Historial visual de la consola reiniciado. El estado real en Supabase se mantiene intacto.",
                  meta: "Consola limpia",
                },
              ])
            }
            className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs font-semibold text-slate-300 transition-colors duration-200 hover:border-white/20 hover:bg-white/[0.08]"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Limpiar pantalla</span>
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 pt-8 sm:px-6 lg:grid-cols-12">
        {/* Panel lateral de telemetría e identidad simulada */}
        <aside className="glass-panel space-y-6 rounded-3xl p-6 lg:col-span-4">
          <fieldset className="space-y-3">
            <legend className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300">
              <Smartphone
                className="h-4 w-4 text-violet-400"
                aria-hidden="true"
              />
              <span>1. Canal de Mensajería</span>
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={`flex cursor-pointer items-center gap-2.5 rounded-2xl border p-3.5 text-xs font-bold transition-colors duration-200 ${
                  channel === "whatsapp"
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                    : "border-white/10 bg-[#07090F] text-slate-400 hover:border-white/20"
                }`}
              >
                <input
                  type="radio"
                  name="sim-channel"
                  checked={channel === "whatsapp"}
                  onChange={() => {
                    setChannel("whatsapp");
                    if (!senderIdentifier.startsWith("+")) {
                      setSenderIdentifier("+573009998877");
                    }
                  }}
                  className="accent-emerald-500"
                />
                <span>WhatsApp Cloud</span>
              </label>

              <label
                className={`flex cursor-pointer items-center gap-2.5 rounded-2xl border p-3.5 text-xs font-bold transition-colors duration-200 ${
                  channel === "telegram"
                    ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
                    : "border-white/10 bg-[#07090F] text-slate-400 hover:border-white/20"
                }`}
              >
                <input
                  type="radio"
                  name="sim-channel"
                  checked={channel === "telegram"}
                  onChange={() => {
                    setChannel("telegram");
                    if (senderIdentifier.startsWith("+")) {
                      setSenderIdentifier("79100234");
                    }
                  }}
                  className="accent-sky-500"
                />
                <span>Telegram Bot</span>
              </label>
            </div>
          </fieldset>

          <div>
            <label
              htmlFor={`${uid}-sim-sender`}
              className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-300"
            >
              2.{" "}
              {channel === "whatsapp"
                ? "Teléfono Remitente (E.164)"
                : "Telegram Chat ID"}
            </label>
            <input
              id={`${uid}-sim-sender`}
              type="text"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={senderIdentifier}
              onChange={(e) => setSenderIdentifier(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 font-mono text-sm font-semibold text-white"
            />

            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() =>
                  setSenderIdentifier(
                    channel === "whatsapp" ? "+573001112233" : "79100234"
                  )
                }
                className={`cursor-pointer rounded-xl border p-2.5 text-left transition-colors duration-200 ${
                  senderIdentifier === "+573001112233" ||
                  senderIdentifier === "79100234"
                    ? "border-violet-500/50 bg-violet-500/15 text-white"
                    : "border-white/10 bg-white/[0.02] text-slate-300 hover:border-white/20"
                }`}
              >
                <span className="block text-[11px] font-bold">
                  Dispositivo A
                </span>
                <span className="mt-0.5 block font-mono text-[10px] text-slate-400">
                  {channel === "whatsapp" ? "+573001112233" : "ID 79100234"}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setSenderIdentifier(
                    channel === "whatsapp" ? "+573009998877" : "88441122"
                  )
                }
                className={`cursor-pointer rounded-xl border p-2.5 text-left transition-colors duration-200 ${
                  senderIdentifier === "+573009998877" ||
                  senderIdentifier === "88441122"
                    ? "border-amber-500/50 bg-amber-500/15 text-amber-100"
                    : "border-white/10 bg-white/[0.02] text-slate-300 hover:border-white/20"
                }`}
              >
                <span className="block text-[11px] font-bold text-amber-300">
                  Dispositivo B (90d)
                </span>
                <span className="mt-0.5 block font-mono text-[10px] text-slate-400">
                  {channel === "whatsapp" ? "+573009998877" : "ID 88441122"}
                </span>
              </button>
            </div>
          </div>

          {/* Prompts rápidos en 1 clic */}
          <div className="space-y-2.5">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300">
              <Zap className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              <span>3. Escenarios Rápidos (1-Clic)</span>
            </p>
            <div className="space-y-2">
              {QUICK_PROMPTS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setMessageText(item.text)}
                  className="w-full cursor-pointer rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 text-left text-xs text-slate-200 transition-colors duration-200 hover:border-violet-500/40 hover:bg-violet-500/10"
                >
                  <span className="font-semibold text-violet-300">
                    {item.label}
                  </span>
                  <span className="mt-0.5 line-clamp-1 block text-[11px] text-slate-400">
                    {item.text}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-[#07090F] p-4 text-xs leading-relaxed text-slate-400">
            <p className="flex items-center gap-1.5 font-semibold text-emerald-300">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <span>Candado Anti-Piratería Activo</span>
            </p>
            <p className="mt-1">
              Si cambias entre <strong>Dispositivo A</strong> y{" "}
              <strong>Dispositivo B</strong>, el teléfono anterior queda en
              estado <code>revoked</code> y el nuevo cambio se bloquea por{" "}
              <strong>90 días</strong>.
            </p>
          </div>
        </aside>

        {/* Terminal de Chat de Alta Precisión */}
        <section className="glass-panel flex h-[78vh] flex-col overflow-hidden rounded-3xl lg:col-span-8">
          {/* Header interno de la terminal */}
          <div className="flex items-center justify-between border-b border-white/10 bg-[#080B12]/90 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-violet-400/30 bg-gradient-to-br from-violet-600 to-indigo-700 font-mono text-sm font-extrabold tracking-tighter text-white shadow-md shadow-violet-600/30">
                GP
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">GENY PRO</span>
                  <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                    RAG 768d + GEMINI 3.8
                  </span>
                </div>
                <p className="font-mono text-[11px] text-slate-400">
                  Canal activo: {channel.toUpperCase()} · Remitente:{" "}
                  <strong className="text-slate-200">{senderIdentifier}</strong>
                </p>
              </div>
            </div>

            <span className="hidden items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-mono text-[11px] font-medium text-amber-300 sm:inline-flex">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Candado 90d
            </span>
          </div>

          {/* Lista de burbujas */}
          <div className="flex-1 space-y-5 overflow-y-auto p-6">
            {bubbles.map((b) => (
              <div
                key={b.id}
                className={`flex flex-col ${
                  b.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3.5 text-sm leading-relaxed ${
                    b.role === "user"
                      ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-600/20"
                      : "border border-white/10 bg-[#0A0D16] text-slate-100 shadow-inner"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{b.text}</p>
                </div>
                {b.meta && (
                  <span className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                    {b.meta}
                  </span>
                )}
                {b.devOtpHint && (
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs text-amber-200">
                    <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{b.devOtpHint}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Barra de composición inferior */}
          <form
            ref={formRef}
            method="POST"
            action="/api/admin/simulator"
            onSubmit={handleSubmit}
            className="border-t border-white/10 bg-[#080B12]/95 p-4"
          >
            {attachedImage && (
              <div className="mb-2.5 inline-flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/15 px-3 py-1.5 text-xs text-violet-200">
                <span>Gráfico adjunto: {attachedImage.name}</span>
                <button
                  type="button"
                  aria-label="Quitar imagen adjunta"
                  onClick={() => {
                    setAttachedImage(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="cursor-pointer hover:text-white"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}

            <div className="flex items-end gap-3">
              <input
                ref={fileInputRef}
                id={`${uid}-sim-file`}
                type="file"
                accept="image/*"
                onChange={(e) => setAttachedImage(e.target.files?.[0] || null)}
                className="sr-only"
              />
              <label
                htmlFor={`${uid}-sim-file`}
                title="Adjuntar captura de gráfico de TradingView"
                className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-white/10 bg-[#07090F] text-slate-300 transition-colors duration-200 hover:border-violet-500/50 hover:text-violet-300"
              >
                <ImagePlus className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">Adjuntar captura de gráfico</span>
              </label>

              <div className="flex-1">
                <label htmlFor={`${uid}-sim-msg`} className="sr-only">
                  Mensaje para GENY PRO
                </label>
                <textarea
                  id={`${uid}-sim-msg`}
                  name="text"
                  rows={2}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={handleTextareaKeyDown}
                  placeholder="Escribe tu duda de trading, correo o código OTP (Enter para enviar)..."
                  className="w-full rounded-2xl border border-white/10 bg-[#07090F] px-4 py-2.5 text-sm text-white placeholder:text-slate-500"
                />
              </div>

              <button
                type="submit"
                disabled={sending}
                className="inline-flex h-12 shrink-0 cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-violet-600/25 transition-colors duration-200 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-60"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                <span>{sending ? "Procesando..." : "Enviar"}</span>
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}

import Link from "next/link";
import {
  ShieldCheck,
  MessageSquare,
  Cpu,
  Lock,
  ArrowRight,
  Database,
  Activity,
  Terminal,
  CheckCircle2,
  Zap,
} from "lucide-react";

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-grid-pattern">
      {/* Ambient Radial Lighting */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[960px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-violet-600/20 via-indigo-500/10 to-amber-500/10 blur-3xl"
      />

      {/* Floating Glass Navbar (uiux-designer: top-4 spacing) */}
      <header className="sticky top-4 z-30 mx-auto max-w-7xl px-4 sm:px-6">
        <div className="glass-panel flex items-center justify-between rounded-2xl px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-400/30 bg-gradient-to-br from-violet-600 to-indigo-700 font-mono text-sm font-extrabold tracking-tighter text-white shadow-lg shadow-violet-600/30">
              GP
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold tracking-tight text-white">
                  GENY PRO
                </span>
                <span className="rounded-md border border-violet-500/30 bg-violet-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-violet-300">
                  OS v2.6
                </span>
              </div>
              <p className="text-xs text-slate-400">
                INGRESARIOS · AI Trading & Mindset Infrastructure
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/simulator"
              className="hidden min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-slate-200 transition-colors duration-200 hover:border-violet-500/40 hover:bg-white/[0.08] sm:inline-flex"
            >
              <Terminal className="h-4 w-4 text-violet-400" aria-hidden="true" />
              <span>Simulador en Vivo</span>
            </Link>
            <Link
              href="/admin"
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors duration-200 hover:from-violet-500 hover:to-indigo-500"
            >
              <span>Centro de Control</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-24 pt-12 sm:px-6 lg:pt-16">
        {/* Hero Grid: Left Copy + Right Interactive Architecture Mockup */}
        <div className="grid items-center gap-12 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-semibold text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              <span>MOTOR CENTRAL ACTIVO · US-EAST-1 · FLUID COMPUTE</span>
            </div>

            <h1 className="mt-6 text-4xl font-extrabold tracking-[-0.03em] text-white sm:text-5xl lg:text-6xl lg:leading-[1.08]">
              Inteligencia institucional para{" "}
              <span className="bg-gradient-to-r from-violet-400 via-fuchsia-300 to-indigo-300 bg-clip-text text-transparent">
                Telegram, WhatsApp
              </span>{" "}
              y{" "}
              <span className="bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-transparent">
                GENY PRO Web
              </span>
              .
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
              Arquitectura soberana de <strong className="text-white">INGRESARIOS</strong>{" "}
              impulsada por <code className="rounded bg-white/10 px-1.5 py-0.5 text-sm text-violet-300">gemini-3.8-flash</code>{" "}
              y <code className="rounded bg-white/10 px-1.5 py-0.5 text-sm text-amber-300">pgvector</code>,
              con protocolo estricto <strong className="text-white">GENY COMPLIANT</strong>,
              sincronización de pagos en tiempo real y candado anti-piratería de 90 días.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/admin"
                className="inline-flex min-h-12 cursor-pointer items-center gap-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-xl shadow-violet-600/25 transition-colors duration-200 hover:from-violet-500 hover:to-indigo-500"
              >
                <Cpu className="h-4 w-4" aria-hidden="true" />
                <span>Abrir Centro de Control (/admin)</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>

              <Link
                href="/simulator"
                className="inline-flex min-h-12 cursor-pointer items-center gap-2.5 rounded-xl border border-white/15 bg-white/[0.04] px-6 py-3.5 text-sm font-semibold text-slate-100 transition-colors duration-200 hover:border-violet-400/40 hover:bg-white/[0.08]"
              >
                <Terminal className="h-4 w-4 text-amber-400" aria-hidden="true" />
                <span>Probar Simulador WhatsApp / Telegram</span>
              </Link>
            </div>

            <div className="mt-10 grid grid-cols-3 gap-4 border-t border-white/10 pt-8">
              <div>
                <p className="font-mono text-2xl font-bold tabular-nums text-white">
                  &lt; 2.0s
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Latencia media c/ Failover
                </p>
              </div>
              <div>
                <p className="font-mono text-2xl font-bold tabular-nums text-amber-400">
                  90 Días
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Candado Anti-Piratería OTP
                </p>
              </div>
              <div>
                <p className="font-mono text-2xl font-bold tabular-nums text-emerald-400">
                  $0 Tokens
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Gasto en usuarios no activos
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Live Telemetry & Pipeline Card */}
          <div className="lg:col-span-5">
            <div className="glass-panel relative overflow-hidden rounded-3xl p-6">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-2">
                  <Activity
                    className="h-4 w-4 text-violet-400"
                    aria-hidden="true"
                  />
                  <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-200">
                    GENY PRO · Neural Pipeline
                  </span>
                </div>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[11px] font-medium text-emerald-300">
                  ONLINE
                </span>
              </div>

              <div className="mt-5 space-y-3.5">
                {[
                  {
                    step: "01",
                    title: "Filtro Candado & Membresía (0ms IA)",
                    desc: "Valida Whop / Stripe / Hotmart + vínculo único de WhatsApp y Telegram con OTP vía Resend.",
                    badge: "Resend Verified",
                    color: "text-amber-300 border-amber-500/30 bg-amber-500/10",
                  },
                  {
                    step: "02",
                    title: "Guardrails Meta & GENY COMPLIANT",
                    desc: "Detecta solicitudes de señales, riesgo emocional o handoff humano antes de invocar al LLM.",
                    badge: "100% Compliant",
                    color: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
                  },
                  {
                    step: "03",
                    title: "RAG Híbrido (768-d Vector + Full-Text)",
                    desc: "Consulta instantánea sobre PEDEM, La Rueda, Reditum Sniper y Geny Trend en Supabase.",
                    badge: "pgvector 768d",
                    color: "text-sky-300 border-sky-500/30 bg-sky-500/10",
                  },
                  {
                    step: "04",
                    title: "Motor Dual: Gemini 3.8 Flash ⇄ Claude 5.5",
                    desc: "Soporte multimodal nativo para texto, notas de voz y capturas de TradingView.",
                    badge: "Failover Activo",
                    color: "text-violet-300 border-violet-500/30 bg-violet-500/10",
                  },
                ].map((item) => (
                  <div
                    key={item.step}
                    className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 transition-colors duration-200 hover:border-white/15"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-xs font-bold text-violet-400">
                          {item.step}
                        </span>
                        <h2 className="text-sm font-bold text-white">
                          {item.title}
                        </h2>
                      </div>
                      <span
                        className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold ${item.color}`}
                      >
                        {item.badge}
                      </span>
                    </div>
                    <p className="mt-1.5 pl-6 text-xs leading-relaxed text-slate-400">
                      {item.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bento Feature Cards */}
        <section
          aria-label="Capacidades activas del sistema"
          className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="glass-card-interactive rounded-2xl p-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/15 text-violet-300">
              <MessageSquare className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-base font-bold text-white">
              Multicanal + Voz y Gráficos
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Webhooks asíncronos con idempotencia para Telegram y WhatsApp Cloud
              API, procesando texto, notas de voz y capturas de gráficos.
            </p>
          </div>

          <div className="glass-card-interactive rounded-2xl p-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/15 text-amber-300">
              <Lock className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-base font-bold text-white">
              Candado Anti-Piratería (90d)
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              1 membresía = 1 Telegram + 1 WhatsApp. Permite autotransferir
              sesión con OTP al correo, respaldando y bloqueando el teléfono
              anterior por 90 días.
            </p>
          </div>

          <div className="glass-card-interactive rounded-2xl p-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-base font-bold text-white">
              Cobros en Tiempo Real
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Conectores nativos para Whop, Stripe y Hotmart + altas manuales,
              importación masiva CSV y suspensión instantánea en 1 clic.
            </p>
          </div>

          <div className="glass-card-interactive rounded-2xl p-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/15 text-sky-300">
              <Database className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-base font-bold text-white">
              RAG + Dataset Propio (.jsonl)
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Búsqueda híbrida sobre PEDEM, La Rueda e indicadores, más
              exportación curada para entrenar el futuro modelo propio de GENY
              PRO.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

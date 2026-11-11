"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Lock,
  Eye,
  EyeOff,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";

export default function AdminLoginClient() {
  const router = useRouter();
  const baseId = useId();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setErrorMsg(data.error || "Credenciales inválidas.");
        setSubmitting(false);
        return;
      }

      router.refresh();
    } catch {
      setErrorMsg("Error de conexión con el servidor.");
      setSubmitting(false);
    }
  }

  const passwordInputId = `${baseId}-admin-password`;
  const warningId = `${baseId}-toggle-warning`;
  const errorId = `${baseId}-login-error`;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-grid-pattern px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/4 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-violet-600/20 blur-3xl"
      />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 flex justify-between items-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 transition-colors duration-200 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Volver al inicio</span>
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-emerald-300">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            HMAC-SHA256
          </span>
        </div>

        <div className="glass-panel rounded-3xl p-8">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-400/30 bg-gradient-to-br from-violet-600 to-indigo-700 font-mono text-base font-extrabold tracking-tighter text-white shadow-lg shadow-violet-600/30">
              GP
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold tracking-tight text-white">
                  GENY PRO
                </h1>
                <span className="rounded-md border border-violet-500/30 bg-violet-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-violet-300">
                  ADMIN
                </span>
              </div>
              <p className="text-xs text-slate-400">
                INGRESARIOS · Centro de Control & Auditoría
              </p>
            </div>
          </div>

          <form
            method="POST"
            action="/api/admin/auth"
            onSubmit={handleSubmit}
            className="mt-7 space-y-5"
          >
            <div>
              <label
                htmlFor={passwordInputId}
                className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-300"
              >
                Llave maestra de acceso
              </label>
              <div className="relative">
                <input
                  id={passwordInputId}
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="••••••••••••••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  aria-describedby={errorMsg ? errorId : undefined}
                  className="min-h-12 w-full rounded-xl border border-white/10 bg-[#07090F] px-4 pr-12 font-mono text-base text-white placeholder:text-slate-600 transition-colors duration-200 focus:border-violet-500"
                />
                <button
                  type="button"
                  aria-pressed={showPassword}
                  aria-label={
                    showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                  aria-describedby={warningId}
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors duration-200 hover:bg-white/10 hover:text-white"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
                <span id={warningId} className="sr-only">
                  Advertencia: esto mostrará tu contraseña en pantalla.
                </span>
              </div>
            </div>

            <div aria-live="polite" className="min-h-5">
              {errorMsg && (
                <p id={errorId} className="text-sm font-medium text-rose-400">
                  {errorMsg}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors duration-200 hover:from-violet-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Lock className="h-4 w-4" aria-hidden="true" />
              <span>
                {submitting ? "Autenticando..." : "Desbloquear Centro de Control"}
              </span>
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

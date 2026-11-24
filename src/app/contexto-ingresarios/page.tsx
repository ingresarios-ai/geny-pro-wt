import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import CopyPlainTextButton from "./CopyPlainTextButton";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Documentos Consolidados en Texto Simple — Ingresarios",
  description:
    "Texto simple unificado de cliente.md, estrategia.md, brief.md y blueprint-webinar.md.",
};

export default function ContextoIngresariosPlainPage() {
  const filePath = path.join(
    process.cwd(),
    "public",
    "contexto-ingresarios.txt"
  );
  const plainText = fs.readFileSync(filePath, "utf8");

  return (
    <main className="min-h-screen bg-[#0B0E17] px-4 py-6 text-slate-100 selection:bg-violet-500/40 selection:text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="sticky top-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#131826]/95 px-4 py-3 shadow-lg backdrop-blur">
          <div>
            <h1 className="text-sm font-bold text-white">
              Texto Simple Consolidado: cliente · estrategia · brief · blueprint-webinar
            </h1>
            <p className="text-xs text-slate-400">
              4 documentos completos en una sola página sin formato Markdown
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <CopyPlainTextButton targetId="plain-doc-content" />
            <a
              href="/contexto-ingresarios.pdf"
              download="contexto-ingresarios.pdf"
              className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-slate-700"
            >
              Descargar PDF
            </a>
            <a
              href="/contexto-ingresarios.txt"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
            >
              Ver .txt puro
            </a>
          </div>
        </header>

        <section className="rounded-xl border border-slate-800 bg-[#111522] p-5 sm:p-8">
          <pre
            id="plain-doc-content"
            className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-100"
          >
            {plainText}
          </pre>
        </section>
      </div>
    </main>
  );
}

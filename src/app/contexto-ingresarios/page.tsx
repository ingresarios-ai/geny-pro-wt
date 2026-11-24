import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Documentos en Texto Simple — Ingresarios",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function ContextoIngresariosPlainPage() {
  const filePath = path.join(process.cwd(), "public", "contexto-ingresarios.txt");
  const plainText = fs.readFileSync(filePath, "utf8");

  return (
    <main className="min-h-screen bg-white px-5 py-8 text-neutral-900 sm:px-10 sm:py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4 text-xs text-neutral-500">
          <span>
            Texto simple consolidado: cliente · estrategia · brief · blueprint-webinar
          </span>
          <a
            href="/contexto-ingresarios.txt"
            className="font-medium text-neutral-800 underline hover:text-black"
          >
            Abrir versión .txt puro
          </a>
        </div>
        <pre className="whitespace-pre-wrap break-words font-sans text-[15px] leading-relaxed text-neutral-900">
          {plainText}
        </pre>
      </div>
    </main>
  );
}

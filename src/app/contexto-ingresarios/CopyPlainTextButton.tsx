"use client";

import { useState } from "react";

export default function CopyPlainTextButton({ targetId }: { targetId: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const el = document.getElementById(targetId);
    const text = el?.innerText || "";
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;inset-block-start:0;opacity:0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleCopy}
        className="cursor-pointer rounded-lg bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500"
      >
        {copied ? "✓ Texto copiado" : "Copiar todo el texto"}
      </button>
      <span role="status" className="sr-only">
        {copied ? "Texto copiado al portapapeles" : ""}
      </span>
    </span>
  );
}

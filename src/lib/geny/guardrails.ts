export interface GuardrailEvaluation {
  isHumanHandoffRequest: boolean;
  needsHumanReview: boolean;
  reviewReason: string | null;
}

const HUMAN_HANDOFF_PATTERNS = [
  /\b(hablar con (un |una )?(humano|persona|asesor|agente|soporte))\b/i,
  /\b(atenci[oó]n humana|soporte humano|necesito un asesor)\b/i,
  /^\/?(humano|soporte|ayuda humana)$/i,
];

const SIGNAL_REQUEST_PATTERNS = [
  /\b(qu[eé] compro|qu[eé] vendo|dame (una )?se[nñ]al|en qu[eé] precio entro|entro (en compra|en venta|ya)|precio objetivo|take profit exacto)\b/i,
  /\b(1k a 10k|duplicar (mi )?cuenta|hacerme rico|ganancia segura|10x)\b/i,
];

const EMOTIONAL_DISTRESS_PATTERNS = [
  /\b(perd[ií] todos? mis ahorros|quem[eé] (toda )?la cuenta|ped[ií] un pr[eé]stamo|estoy desesperad[oa]|no puedo dormir por perder|meter todo mi dinero)\b/i,
];

export function evaluateGuardrails(userText: string): GuardrailEvaluation {
  const clean = userText.trim();

  if (HUMAN_HANDOFF_PATTERNS.some((rx) => rx.test(clean))) {
    return {
      isHumanHandoffRequest: true,
      needsHumanReview: true,
      reviewReason: "solicitud_soporte_humano",
    };
  }

  if (EMOTIONAL_DISTRESS_PATTERNS.some((rx) => rx.test(clean))) {
    return {
      isHumanHandoffRequest: false,
      needsHumanReview: true,
      reviewReason: "alerta_riesgo_emocional_o_capital",
    };
  }

  if (SIGNAL_REQUEST_PATTERNS.some((rx) => rx.test(clean))) {
    return {
      isHumanHandoffRequest: false,
      needsHumanReview: true,
      reviewReason: "solicitud_senal_o_rentabilidad",
    };
  }

  // Muestra aleatoria del 5% para la revisión humana semanal del protocolo GENY COMPLIANT
  if (Math.random() < 0.05) {
    return {
      isHumanHandoffRequest: false,
      needsHumanReview: true,
      reviewReason: "muestra_aleatoria_semanal",
    };
  }

  return {
    isHumanHandoffRequest: false,
    needsHumanReview: false,
    reviewReason: null,
  };
}


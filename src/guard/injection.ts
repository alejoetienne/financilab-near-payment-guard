/**
 * Prompt-injection / agent-manipulation detector for text that reaches a
 * payment agent (forwarded messages, chat instructions, memos).
 * Deterministic regexes over normalized text (lowercase, no accents), ES + EN.
 */
import { normalizeText } from './scamShield.js';

export type InjectionKind =
  | 'override'
  | 'role_spoof'
  | 'drain'
  | 'bypass_human'
  | 'receiver_swap'
  | 'secrecy'
  | 'hidden_chars'
  | 'key_exfiltration';

export interface InjectionHit {
  kind: InjectionKind;
  match: string;
}

export interface InjectionReport {
  hits: InjectionHit[];
  kinds: InjectionKind[];
  /** The text also asks for a payment/transfer (so the injection is "armed"). */
  paymentIntent: boolean;
}

const PATTERNS: Array<{ kind: InjectionKind; re: RegExp }> = [
  // Instruction override
  { kind: 'override', re: /\b(ignora|ignorar|olvida|olvidate de|descarta|omite|anula)\b[^.\n]{0,40}\b(instrucciones|reglas|indicaciones|ordenes|politicas?|limites|restricciones|lo anterior)\b/ },
  { kind: 'override', re: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(instructions|rules|guidelines|policy|policies|limits|guardrails|prompt|everything above)\b/ },
  { kind: 'override', re: /\b(nuevas instrucciones|new instructions|a partir de ahora (eres|vas a)|from now on you (are|will)|you are now|ahora eres)\b/ },
  { kind: 'override', re: /\b(modo desarrollador|developer mode|jailbreak|dan mode|modo administrador|admin mode|god mode)\b/ },
  // Role / channel spoofing
  { kind: 'role_spoof', re: /(^|\n|\s|\[|<)(sistema|system|assistant|asistente|developer|admin|administrador|root)\s*(:|\]|>)/ },
  { kind: 'role_spoof', re: /<\/?(system|sys|instructions?|admin)>|\[\/?(inst|system)\]|#{2,}\s*(system|sistema)/ },
  { kind: 'role_spoof', re: /\b(mensaje del sistema|system message|system prompt|orden del administrador|admin override|mensaje oficial de financilab)\b/ },
  // Drain the wallet
  { kind: 'drain', re: /\b(envia|enviar|manda|mandar|transfiere|transferir|pasa|deposita|retira)\b[^.\n]{0,30}\b(todo|todos|toda|el total)\b[^.\n]{0,20}\b(saldo|fondos|balance|dinero|near|la billetera|tu billetera|la wallet)\b/ },
  { kind: 'drain', re: /\b(send|transfer|move|withdraw|drain)\b[^.\n]{0,25}\b(all|entire|whole|full|max(imum)?)\b[^.\n]{0,20}\b(funds|balance|near|tokens|wallet|money)\b/ },
  { kind: 'drain', re: /\b(vacia|vaciar|drena|drenar|empty|drain)\b[^.\n]{0,20}\b(billetera|wallet|cuenta|account)\b/ },
  // Skip the human
  { kind: 'bypass_human', re: /\b(no|nunca)\s+(le\s+|les\s+)?(preguntes|preguntar|consultes|consultar|avises|avisar|confirmes|pidas confirmacion|pedir confirmacion|notifiques|notificar|pidas permiso|pedir permiso|molestes|esperes (la )?aprobacion)\b/ },
  { kind: 'bypass_human', re: /\bsin (preguntar|consultar|avisar|confirmar|confirmacion|aprobacion|pedir permiso)\b/ },
  { kind: 'bypass_human', re: /\b(don'?t|do not|never)\s+(ask|tell|notify|bother|check with|wait for)\b[^.\n]{0,20}\b(user|owner|human|anyone|them|him|her|approval|confirmation)\b/ },
  { kind: 'bypass_human', re: /\bwithout\s+(asking|telling|notifying|confirming|confirmation|approval|checking)\b/ },
  { kind: 'bypass_human', re: /\b(auto-?aprueba|aprueba automaticamente|auto-?approve|skip (the )?(confirmation|approval|review)|salta(te)? la (confirmacion|aprobacion|revision))\b/ },
  // Change receiver mid-flow
  { kind: 'receiver_swap', re: /\b(cambia|cambiar|reemplaza|reemplazar|actualiza|actualizar|modifica)\b[^.\n]{0,25}\b(la )?(cuenta|direccion|destinatario|receptor|wallet|billetera)\b/ },
  { kind: 'receiver_swap', re: /\b(change|replace|update|switch|swap)\b[^.\n]{0,25}\b(the )?(receiver|recipient|destination|address|account|beneficiary)\b/ },
  { kind: 'receiver_swap', re: /\b(en lugar de|en vez de|instead of|instead)\b[^.\n]{0,40}\b(envia|manda|transfiere|send|transfer|pay|cuenta|account|address)\b/ },
  { kind: 'receiver_swap', re: /\b(send|transfer|pay|envia|enviala|envialo|manda|mandala|mandalo|paga|transfiere)\b[^\n]{0,60}\b(instead|en su lugar|mejor a)\b/ },
  { kind: 'receiver_swap', re: /\b(la cuenta correcta es|la nueva cuenta es|mi nueva cuenta es|the correct (account|address) is|(my )?new (account|address) is)\b/ },
  // Secrecy (common in social engineering + agent manipulation)
  { kind: 'secrecy', re: /\b(no se lo digas|no le digas|mantenlo en secreto|es confidencial|don'?t tell (the user|anyone)|keep (this|it) (secret|confidential)|no lo menciones)\b/ },
  // Asking the agent for keys / seed phrases
  { kind: 'key_exfiltration', re: /\b(private key|clave privada|llave privada|seed phrase|frase semilla|frase de recuperacion|mnemonic|12 palabras|secret key|full access key|access key)\b/ },
];

const PAYMENT_INTENT = /\b(envia|enviar|envie|manda|mandar|transfiere|transferir|transfiera|paga|pagar|pague|deposita|depositar|deposite|send|transfer|pay|deposit|wire)\b|\bnear\b|Ⓝ/;

// Zero-width, bidi overrides and tag characters used to hide instructions.
const HIDDEN_CHARS = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/u;

export function detectInjection(text: string | undefined): InjectionReport {
  const raw = text ?? '';
  const hits: InjectionHit[] = [];
  if (HIDDEN_CHARS.test(raw)) hits.push({ kind: 'hidden_chars', match: 'invisible/bidi unicode characters' });
  // Keep newlines for role-spoof detection; normalizeText collapses spaces only.
  const norm = normalizeText(raw.replace(/[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, ''));
  for (const p of PATTERNS) {
    const m = p.re.exec(norm);
    if (m && !hits.some((h) => h.kind === p.kind)) hits.push({ kind: p.kind, match: m[0].trim().slice(0, 80) });
  }
  return {
    hits,
    kinds: [...new Set(hits.map((h) => h.kind))],
    paymentIntent: PAYMENT_INTENT.test(norm),
  };
}

export const INJECTION_LABELS: Record<InjectionKind, { es: string; en: string }> = {
  override: { es: 'intenta anular las instrucciones del asistente', en: 'tries to override the assistant’s instructions' },
  role_spoof: { es: 'se hace pasar por el "sistema" o un administrador', en: 'impersonates the "system" or an administrator' },
  drain: { es: 'pide enviar todo el saldo', en: 'asks to send the entire balance' },
  bypass_human: { es: 'pide no consultar ni avisar al usuario', en: 'asks not to ask or notify the user' },
  receiver_swap: { es: 'pide cambiar la cuenta destino a mitad del proceso', en: 'asks to change the receiver mid-flow' },
  secrecy: { es: 'pide mantenerlo en secreto', en: 'asks to keep it secret' },
  hidden_chars: { es: 'contiene caracteres invisibles que pueden ocultar instrucciones', en: 'contains invisible characters that can hide instructions' },
  key_exfiltration: { es: 'menciona claves privadas o frases semilla', en: 'mentions private keys or seed phrases' },
};

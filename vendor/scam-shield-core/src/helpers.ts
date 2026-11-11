import type { AnalysisResult, Category, Locale } from './types.js';

type Pair = { es: string; en: string };

const REPLIES: Partial<Record<Category, Pair>> & { default: Pair; safe: Pair } = {
  default: {
    es: 'Gracias, pero no comparto datos personales, códigos ni hago pagos por mensaje. Verificaré directamente por los canales oficiales.',
    en: 'Thanks, but I do not share personal data or codes, or make payments by message. I will verify directly through official channels.',
  },
  safe: {
    es: 'Gracias por la información. Lo confirmaré por los canales oficiales si es necesario.',
    en: 'Thanks for the information. I will confirm through official channels if needed.',
  },
  bank_impersonation: {
    es: 'No comparto códigos ni datos por mensaje. Me comunicaré directamente con mi banco al número oficial.',
    en: 'I do not share codes or details by message. I will contact my bank directly at its official number.',
  },
  whatsapp_number_swap: {
    es: 'Antes de enviar dinero te voy a llamar a tu número de siempre para confirmar que sos vos.',
    en: 'Before sending any money I will call your usual number to confirm it is really you.',
  },
  account_takeover: {
    es: 'No reenvío códigos de verificación a nadie. Si fue un error, solicitalo de nuevo a tu número.',
    en: 'I do not forward verification codes to anyone. If it was a mistake, request it again to your own number.',
  },
  remittance_fee: {
    es: 'No voy a pagar ninguna comisión. Consultaré mi remesa directamente en la agencia o app oficial.',
    en: 'I will not pay any fee. I will check my remittance directly with the official agent or app.',
  },
  crypto_investment: {
    es: 'No me interesa. No invierto con promesas de ganancias garantizadas.',
    en: 'Not interested. I do not invest based on promises of guaranteed returns.',
  },
  prize_lottery: {
    es: 'No participé en ningún sorteo y no pagaré nada para recibir premios.',
    en: 'I did not enter any draw and will not pay anything to receive prizes.',
  },
  fake_job: {
    es: 'Gracias, pero no pago por empleos. Si la oferta es real, envíenme los datos oficiales de la empresa.',
    en: 'Thanks, but I do not pay for jobs. If the offer is real, send me the company’s official details.',
  },
};

/**
 * Draft a short, safe reply the user can send (or simply not send — ignoring
 * and blocking is always fine). Accepts an analysis result or a category.
 */
export function draftSafeReply(resultOrCategory: AnalysisResult | Category, locale: Locale = 'es'): string {
  let pair: Pair;
  if (typeof resultOrCategory === 'string') {
    pair = REPLIES[resultOrCategory] ?? (resultOrCategory === 'none' ? REPLIES.safe : REPLIES.default);
  } else if (resultOrCategory.verdict === 'safe') {
    pair = REPLIES.safe;
  } else {
    pair = REPLIES[resultOrCategory.category] ?? REPLIES.default;
  }
  return pair[locale];
}

const TIPS: Record<Category, Pair[]> = {
  bank_impersonation: [
    { es: 'Su banco nunca le pedirá su PIN, token o código por SMS, WhatsApp o llamada.', en: 'Your bank will never ask for your PIN, token or code by SMS, WhatsApp or phone.' },
    { es: 'Revise el dominio: los bancos nicaragüenses usan dominios oficiales, no .xyz ni enlaces acortados.', en: 'Check the domain: Nicaraguan banks use official domains, never .xyz or shortened links.' },
  ],
  payment_platform_impersonation: [
    { es: 'Para revisar su cuenta de PayPal, abra la app; no use enlaces de mensajes.', en: 'To check your PayPal account, open the app; do not use links from messages.' },
  ],
  remittance_fee: [
    { es: 'Las remesas no se “liberan” pagando comisiones extra por WhatsApp o depósitos.', en: 'Remittances are never “released” by paying extra fees over WhatsApp or deposits.' },
  ],
  crypto_investment: [
    { es: 'Si le prometen duplicar su dinero, es una estafa piramidal o un robo directo.', en: 'If someone promises to double your money, it is a Ponzi scheme or outright theft.' },
  ],
  prize_lottery: [
    { es: 'Un premio real nunca le cobra para entregarlo.', en: 'A real prize never charges you to receive it.' },
  ],
  fake_job: [
    { es: 'Desconfíe de trabajos que pagan mucho por tareas simples como dar “likes”.', en: 'Be wary of jobs that pay a lot for simple tasks like giving “likes”.' },
  ],
  whatsapp_number_swap: [
    { es: 'Si un familiar escribe desde un número nuevo pidiendo dinero, llámele a su número anterior.', en: 'If a relative writes from a new number asking for money, call their old number.' },
  ],
  account_takeover: [
    { es: 'Active la verificación en dos pasos de WhatsApp: Ajustes > Cuenta > Verificación en dos pasos.', en: 'Turn on WhatsApp two-step verification: Settings > Account > Two-step verification.' },
  ],
  credential_theft: [
    { es: 'Sus códigos de verificación son como la llave de su casa: no se comparten con nadie.', en: 'Your verification codes are like your house key: never share them with anyone.' },
  ],
  phishing_link: [
    { es: 'Mantenga presionado un enlace para ver su dominio real antes de abrirlo.', en: 'Long-press a link to see its real domain before opening it.' },
    { es: 'Letras raras o números en lugar de letras (paypa1, banpr0) delatan dominios falsos.', en: 'Odd letters or digits in place of letters (paypa1, banpr0) reveal fake domains.' },
  ],
  advance_fee: [
    { es: 'Nunca pague por adelantado para recibir dinero, paquetes o préstamos.', en: 'Never pay upfront to receive money, packages or loans.' },
  ],
  none: [
    { es: 'Ante la duda, contacte a la institución por un canal que usted mismo busque.', en: 'When in doubt, contact the institution through a channel you look up yourself.' },
  ],
};

/** Short educational tip for a category. `seed` lets callers rotate between tips. */
export function educationTip(category: Category = 'none', locale: Locale = 'es', seed = 0): string {
  const list = TIPS[category] ?? TIPS.none;
  const tip = list[Math.abs(Math.floor(seed)) % list.length]!;
  return tip[locale];
}

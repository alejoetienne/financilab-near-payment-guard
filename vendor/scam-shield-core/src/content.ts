import type { Category, Locale, Signal, Verdict } from './types.js';

export const CATEGORY_LABELS: Record<Category, { es: string; en: string }> = {
  bank_impersonation: { es: 'suplantación de banco', en: 'bank impersonation' },
  payment_platform_impersonation: { es: 'suplantación de plataforma de pagos', en: 'payment platform impersonation' },
  remittance_fee: { es: 'fraude de remesa retenida', en: 'held-remittance fee scam' },
  crypto_investment: { es: 'estafa de inversión/cripto', en: 'crypto/investment scam' },
  prize_lottery: { es: 'premio o lotería falsa', en: 'fake prize or lottery' },
  fake_job: { es: 'oferta de empleo falsa', en: 'fake job offer' },
  whatsapp_number_swap: { es: 'suplantación por "número nuevo"', en: '"new number" impersonation' },
  account_takeover: { es: 'robo de cuenta (WhatsApp/códigos)', en: 'account takeover (WhatsApp/codes)' },
  credential_theft: { es: 'robo de datos o códigos', en: 'credential/code theft' },
  phishing_link: { es: 'enlace sospechoso', en: 'suspicious link' },
  advance_fee: { es: 'cobro por adelantado', en: 'advance-fee scam' },
  none: { es: 'sin categoría', en: 'no category' },
};

export const ADVICE: Record<Category, { es: string; en: string }> = {
  bank_impersonation: {
    es: 'No abra el enlace ni comparta códigos. Llame a su banco al número al reverso de su tarjeta o use la app oficial.',
    en: 'Do not open the link or share codes. Call your bank using the number on the back of your card or use the official app.',
  },
  payment_platform_impersonation: {
    es: 'No inicie sesión desde el enlace. Abra la app o escriba la dirección oficial usted mismo.',
    en: 'Do not log in from the link. Open the official app or type the official address yourself.',
  },
  remittance_fee: {
    es: 'No pague ninguna “comisión de liberación”. Consulte su remesa solo en la app oficial o en una agencia autorizada con su número de control.',
    en: 'Do not pay any “release fee”. Check your remittance only in the official app or at an authorized agent using your tracking number.',
  },
  crypto_investment: {
    es: 'Nadie puede duplicar su dinero de forma garantizada. No envíe fondos; denuncie y bloquee al contacto.',
    en: 'Nobody can guarantee to double your money. Do not send funds; report and block the contact.',
  },
  prize_lottery: {
    es: 'Si no participó, no ganó. Nunca pague para recibir un premio ni comparta datos personales.',
    en: 'If you did not enter, you did not win. Never pay to receive a prize or share personal data.',
  },
  fake_job: {
    es: 'Los empleos reales no piden pagos ni prometen ganancias por dar “likes”. Investigue la empresa por canales oficiales.',
    en: 'Real jobs do not ask for payments or pay you for “likes”. Research the company through official channels.',
  },
  whatsapp_number_swap: {
    es: 'Antes de enviar dinero, llame al número que ya tenía guardado o haga una pregunta que solo esa persona sepa.',
    en: 'Before sending money, call the number you already had saved or ask a question only that person would know.',
  },
  account_takeover: {
    es: 'Nunca reenvíe códigos de verificación. Active la verificación en dos pasos en WhatsApp.',
    en: 'Never forward verification codes. Turn on two-step verification in WhatsApp.',
  },
  credential_theft: {
    es: 'Nunca comparta PIN, códigos, contraseñas ni datos de tarjeta por mensaje o llamada.',
    en: 'Never share PINs, codes, passwords or card details by message or phone call.',
  },
  phishing_link: {
    es: 'No abra el enlace. Si cree que es real, entre escribiendo usted mismo la dirección oficial.',
    en: 'Do not open the link. If you think it is real, type the official address yourself.',
  },
  advance_fee: {
    es: 'No pague cargos por adelantado para recibir dinero, paquetes o premios. Verifique por canales oficiales.',
    en: 'Do not pay upfront fees to receive money, packages or prizes. Verify through official channels.',
  },
  none: {
    es: 'No se detectaron señales claras de fraude. Aun así, nunca comparta códigos ni contraseñas.',
    en: 'No clear scam signals were detected. Even so, never share codes or passwords.',
  },
};

export function buildExplanation(
  verdict: Verdict,
  category: Category,
  signals: Signal[],
  locale: Locale,
): string {
  const top = signals
    .filter((s) => s.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((s) => (locale === 'es' ? s.reasonEs : s.reasonEn));
  const label = CATEGORY_LABELS[category][locale];
  if (locale === 'es') {
    const head =
      verdict === 'scam'
        ? `Muy probablemente es una estafa (${label}).`
        : verdict === 'suspicious'
          ? `Mensaje sospechoso${category !== 'none' ? ` (${label})` : ''}: tenga cuidado.`
          : 'No se encontraron señales fuertes de estafa.';
    return top.length ? `${head} ${top.join(' ')}` : head;
  }
  const head =
    verdict === 'scam'
      ? `Very likely a scam (${label}).`
      : verdict === 'suspicious'
        ? `Suspicious message${category !== 'none' ? ` (${label})` : ''}: be careful.`
        : 'No strong scam signals were found.';
  return top.length ? `${head} ${top.join(' ')}` : head;
}

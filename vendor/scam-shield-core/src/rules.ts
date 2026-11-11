import { BRANDS, type Brand } from './brands.js';
import { normalizeText, splitSentences } from './normalize.js';
import type { AnalyzeInput, Category, Signal } from './types.js';
import {
  RISKY_TLDS,
  SHORTENERS,
  detectLookalike,
  extractUrls,
  isOfficialAny,
  isOfficialFor,
  parseUrl,
  type ParsedUrl,
} from './url.js';

export interface RuleContext {
  original: string;
  text: string;
  sentences: string[];
  /** Sentences that are not protective warnings ("nunca le pediremos su PIN"). */
  activeSentences: string[];
  urls: ParsedUrl[];
  brands: Brand[];
}

export interface RuleHit extends Signal {
  category?: Category;
}

// Phrases that are typical of legitimate warnings rather than requests.
const PROTECTIVE =
  /\b(nunca|jamas|no)\s+(le\s+|lo\s+|la\s+|les\s+|te\s+|se\s+|los\s+)?(solicit\w*|pedi\w*|pid\w*|ped\w*|compart\w*|proporcion\w*|brind\w*|revel\w*|entregu\w*|des\b|de\b|envi\w*)|\b(never|do not|don't|will not|won't)\s+(ask|share|send|request|give|disclose)\w*/;

function sentenceIsProtective(s: string): boolean {
  return PROTECTIVE.test(s);
}

export function buildContext(input: AnalyzeInput): RuleContext {
  const original = `${input.text ?? ''}`;
  const text = normalizeText(original);
  const sentences = splitSentences(text);
  const activeSentences = sentences.filter((s) => !sentenceIsProtective(s));
  const rawUrls = extractUrls(original);
  if (input.url && input.url.trim()) rawUrls.unshift(input.url.trim());
  const seen = new Set<string>();
  const urls: ParsedUrl[] = [];
  for (const r of rawUrls) {
    const p = parseUrl(r);
    if (p && !seen.has(p.host + p.path)) {
      seen.add(p.host + p.path);
      urls.push(p);
    }
  }
  const brands = BRANDS.filter((b) => b.mention.test(text));
  return { original, text, sentences, activeSentences, urls, brands };
}

const anyActive = (ctx: RuleContext, re: RegExp) => ctx.activeSentences.some((s) => re.test(s));

// ---------- Vocabulary ----------
const REQUEST_VERB =
  '(envi[aeo]\\w*|mand[aeo]\\w*|reenvi\\w*|compart\\w*|dict[aeo]\\w*|dig[ae]\\w*|decime|decir|proporcion\\w*|indiqu\\w*|ingres[aeo]\\w*|confirm[aeo]\\w*|facilit\\w*|brind\\w*|pas[ae]\\w*|pasar\\w*|escrib\\w*|actualic\\w*|actualiz\\w*|valid[aeo]\\w*|verifiqu\\w*|digit\\w*|responda\\w*|respond[ae]\\w*|send|share|provide|enter|confirm|reply|tell|give|verify|update)';
const OTP_NOUN =
  '(codigo|clave|pin\\b|token|otp|contrasena|password|passcode|code|cvv|cvc|numero de (su |tu )?tarjeta|datos de (su |tu )?tarjeta|card number|card details|fecha de vencimiento|clave dinamica|usuario y contrasena|credenciales|credentials)';
const RE_CRED_REQUEST = new RegExp(`${REQUEST_VERB}\\b[^.!?\\n]{0,60}\\b${OTP_NOUN}|${OTP_NOUN}[^.!?\\n]{0,40}\\b(que le|que te|que recib|que llego|que le llego|you received|we sent)[^.!?\\n]{0,40}${REQUEST_VERB}`);
const RE_CARD = /\b(cvv|cvc|codigo de seguridad de (su |tu |la )?tarjeta|numero (completo )?de (su |tu |la )?tarjeta|fecha de (vencimiento|expiracion)|datos de (su |tu |la )?tarjeta|card number|security code|expiration date)\b/;
const RE_PASSWORD = /\b(contrasena|password|usuario y clave|clave de (acceso|internet|banca)|credenciales|credentials)\b/;
const RE_OTP_WORD = /\b(codigo|clave dinamica|token|otp|pin|code)\b/;

const RE_URGENCY_BLOCK =
  /\b(cuenta|tarjeta|usuario|acceso|banca|servicio|account|card)\b[^.!?\n]{0,50}\b(sera|ha sido|fue|esta|quedara|queda|will be|has been|is)\s+(temporalmente\s+)?(bloquead|suspendid|desactivad|cancelad|inhabilitad|restringid|cerrad|locked|suspended|blocked|disabled|closed|restricted)\w*|\b(bloqueo|suspension|cierre|cancelacion) (de|definitiv\w*)\b[^.!?\n]{0,30}\b(cuenta|tarjeta)|\bevite (el |la )?(bloqueo|suspension|cierre|cancelacion)|\b(avoid|prevent) (the )?(suspension|lock|closure)/;
const RE_URGENCY_TIME =
  /\b(en las? (proximas? )?\d+ ?(horas|hrs|h|minutos)|en menos de \d+|inmediatamente|de inmediato|urgente|ultimo aviso|hoy mismo|antes de las \d+|ahora mismo|solo por hoy|within \d+ (hours|minutes)|immediately|urgent|final notice|last warning|right now|expira hoy|vence hoy)\b/;
const RE_VERIFY_LINK =
  /\b(ingres[ae]\w* (al|a este|en el|aqui|al siguiente)|haga clic|hac[ae] clic|de clic|click (aqui|here|the link|on)|toque el enlace|siguiente (enlace|link)|en este (enlace|link)|verifi\w* (sus|tus) (datos|informacion|identidad)|actualic\w* (sus|tus) (datos|informacion)|actualizar (sus|tus) (datos|informacion)|reactiv\w*|desbloque\w*|validar (su|tu) (cuenta|identidad)|update your (details|information|account)|verify your (account|identity|information)|log ?in (here|now))\b/;
const RE_UNUSUAL =
  /\b(actividad (inusual|sospechosa)|movimiento (inusual|sospechoso)|acceso no autorizado|intento de acceso|cargo no reconocido|unusual activity|suspicious activity|unauthorized (access|login))\b/;
const RE_CRYPTO = /\b(bitcoin|btc|usdt|cripto\w*|crypto\w*|ethereum|eth|binance|tether|trading|forex|inversion|invierta|invest\w*)\b/;
const RE_CRYPTO_ASSET = /\b(bitcoin|btc|usdt|cripto\w*|crypto\w*|ethereum|eth|binance|tether)\b/;
const RE_EXPLICIT_DOUBLING = /\b(duplic\w*|doble|triplic\w*|x2|x3|multiplica\w*|double\w*|triple\w*|\d{1,3} ?% (diario|semanal|daily|weekly))\b/;
const RE_DOUBLING =
  /\b(duplic\w*|doble|triplic\w*|x2|x3|multiplica\w*|double\w*|triple\w*|ganancia(s)? garantizad\w*|rendimiento(s)? garantizad\w*|guaranteed (returns?|profits?)|sin riesgo|risk[- ]free|\d{1,3} ?% (diario|semanal|daily|weekly)|ganancias? diarias?|daily (profit|returns?))\b/;
const RE_REMITTANCE = /\b(remesa\w*|envio de dinero|giro|western ?union|remitly|transferencia internacional|money transfer|remittance)\b/;
const RE_RETAINED =
  /\b(retenid\w*|detenid\w*|en espera|pendiente de (pago|liberacion)|bloquead\w*|congelad\w*|on hold|held|retained|frozen|no (puede|podra) ser (cobrad|retirad|liberad)\w*)\b/;
const RE_FEE =
  /\b(pague|pagar|pago de|deposite|depositar|cancele|cancelar) [^.!?\n]{0,40}\b(comision|cargo|tarifa|impuesto|arancel|aduana|seguro|liberacion|desaduanaje|tramite|fee|tax)\b|\b(comision|cargo|tarifa|impuesto|fee|tax)\b[^.!?\n]{0,40}\b(para (liberar|recibir|retirar|cobrar|desbloquear)|to (release|receive|unlock|claim))\b|\bpara (liberar|desbloquear|recibir) (su|tu|el|la)\b[^.!?\n]{0,40}\b(pague|deposite|envie|transfiera|pay|deposit)\w*/;
const RE_PRIZE =
  /\b(ha(s)? ganado|usted gano|ganaste|gano un|ganador\w*|premio|sorteo|loteria|rifa|felicidades[^.!?\n]{0,40}(seleccionad|elegid|ganad)\w*|ha sido (seleccionad|elegid)\w*|you('ve| have)? won|winner|prize|lottery|giveaway)\b/;
const RE_JOB =
  /\b(trabajo|empleo|vacante|oferta laboral|trabaja|job|work)\b[^.!?\n]{0,60}\b(desde (su |tu )?casa|remoto|medio tiempo|tiempo parcial|from home|part[- ]time|sin experiencia)\b|\b(gan[ae]\w*|earn\w*|ingresos? de)\b[^.!?\n]{0,25}(\$|us\$|usd|c\$|cordobas|dolares|dollars)\s?\d[\d,.]*\s?(al dia|diarios?|por dia|semanal\w*|a la semana|per day|daily|a day|por hora|per hour)|\b(dar (likes?|me gusta)|dando (likes?|me gusta)|calificar\w* (productos|hoteles)|calificando|tareas (sencillas|simples)|simple tasks|like (videos|posts))\b|\b(reclutador\w*|recruiter|recursos humanos)\b[^.!?\n]{0,60}\b(whats\s?app|telegram)\b/;
const RE_JOB_PAY = /\b(gan[ae]\w*|earn\w*|ingresos? de|pagamos)\b[^.!?\n]{0,25}(\$|us\$|usd|c\$|cordobas|dolares|dollars)\s?\d/;
const RE_JOB_TASKS = /\b(dar (likes?|me gusta)|dando (likes?|me gusta)|calificar\w* (productos|hoteles)|calificando|tareas (sencillas|simples)|simple tasks|like (videos|posts))\b/;
const RE_JOB_CONTACT = /\b(reclutador\w*|recruiter)\b|\btelegram\b/;
const RE_JOB_FEE = /\b(pague|deposite|pagar|depositar|inscripcion|kit de inicio|registration fee|starter kit|matricula)\b/;
const RE_NEW_NUMBER =
  /\b(cambi[eé] de numero|cambie mi numero|este es mi (nuevo )?numero|mi nuevo numero|nuevo numero|perdi (mi|el) (telefono|celular|cel)|me robaron el (telefono|celular|cel)|se me (arruino|danio|cayo|perdio) el (telefono|celular|cel)|guarda(lo|me)? este numero|agenda este numero|new number|changed my number|lost my phone)\b/;
const RE_MONEY_REQUEST =
  /\b(prest[ae]me|prestame|me (podes|puedes|podrias|puede) (prestar|depositar|transferir|mandar|enviar|pasar)|necesito que me (deposites|transfieras|prestes|mandes|envies|pases)|deposit[ae]me|transferime|transfiereme|mandame (dinero|plata|reales|pisto|\d)|me urge (dinero|plata|pisto)|can you (lend|send|transfer) me|send me money)\b/;
const RE_WA_CODE =
  /\b(codigo (de )?(6|seis) digitos|te (envie|mande|llego) un codigo|codigo que te (llego|envie|mande)|sent you a (6[- ]digit )?code)\b/;
const RE_UNSOLICITED_PAYMENT =
  /\b(reembolso|devolucion|refund|bono|subsidio|beneficio|bonus)\b[^.!?\n]{0,60}\b(reclam\w*|cobr\w*|recib\w*|claim|haga clic|ingrese|link|enlace)\b/;
const RE_PACKAGE =
  /\b(paquete|envio|encomienda|package|parcel|delivery)\b[^.!?\n]{0,60}\b(retenid\w*|pendiente|no (pudo ser|se pudo) entregar|aduana|held|could not be delivered)\b/;
const RE_SAFETY_CHANNEL =
  /\b(llam[ae]\w* al (numero|telefono) (al reverso|oficial|que aparece)|al reverso de (su|tu) tarjeta|desde (la )?app oficial|nuestra app oficial|directamente en (la )?(app|aplicacion|sucursal)|acuda a (su|una) sucursal|official app|call the number on the back)\b/;

function hit(
  id: string,
  weight: number,
  reasonEs: string,
  reasonEn: string,
  category?: Category,
): RuleHit {
  return { id, weight, reasonEs, reasonEn, category };
}

function brandCategory(b: Brand): Category {
  if (b.kind === 'bank') return 'bank_impersonation';
  if (b.kind === 'remittance') return 'remittance_fee';
  if (b.kind === 'messaging') return 'account_takeover';
  return 'payment_platform_impersonation';
}

/** Run every offline rule and return the matching signals. */
export function runRules(ctx: RuleContext): RuleHit[] {
  const hits: RuleHit[] = [];
  const t = ctx.text;
  const mainBrand = ctx.brands.find((b) => b.kind !== 'messaging') ?? ctx.brands[0];

  // ---------- URL / domain rules ----------
  let urlProblems = 0;
  for (const u of ctx.urls) {
    const label = u.unicodeHost;
    const official = isOfficialAny(u);
    const look = detectLookalike(u);
    if (u.isIdn) {
      urlProblems++;
      if (look) {
        hits.push(hit('homoglyph_domain', 60,
          `El dominio "${label}" usa caracteres de otro alfabeto para imitar a ${look.name}.`,
          `The domain "${label}" uses look-alike characters to imitate ${look.name}.`,
          brandCategory(look)));
      } else {
        hits.push(hit('punycode_domain', 30,
          `El dominio "${u.host}" usa caracteres internacionales (punycode), una técnica común para disfrazar enlaces.`,
          `The domain "${u.host}" uses internationalized (punycode) characters, often used to disguise links.`,
          'phishing_link'));
      }
    } else if (look) {
      urlProblems++;
      hits.push(hit('lookalike_domain', 60,
        `El enlace "${u.host}" imita a ${look.name} pero no es su dominio oficial.`,
        `The link "${u.host}" imitates ${look.name} but is not its official domain.`,
        brandCategory(look)));
    }
    if (u.isIp) {
      urlProblems++;
      hits.push(hit('ip_host', 40,
        `El enlace apunta a una dirección IP (${u.host}) en lugar de un dominio; los bancos nunca hacen esto.`,
        `The link points to a raw IP address (${u.host}) instead of a domain; banks never do this.`,
        'phishing_link'));
    }
    if (!u.isIp && RISKY_TLDS.has(u.tld)) {
      urlProblems++;
      hits.push(hit('risky_tld', 30,
        `El dominio termina en ".${u.tld}", una extensión barata muy usada en fraudes.`,
        `The domain ends in ".${u.tld}", a cheap extension frequently abused by scammers.`,
        'phishing_link'));
    }
    if (SHORTENERS.has(u.host) || SHORTENERS.has(u.registrable)) {
      urlProblems++;
      hits.push(hit('url_shortener', 25,
        `El enlace está acortado (${u.host}), lo que oculta el destino real.`,
        `The link is shortened (${u.host}), hiding its real destination.`,
        'phishing_link'));
    }
    if (u.scheme === 'http' && !official) {
      hits.push(hit('http_only', 10,
        'El enlace usa "http" sin cifrado (no "https").',
        'The link uses unencrypted "http" (not "https").'));
    }
    if (u.hasUserInfo) {
      urlProblems++;
      hits.push(hit('url_userinfo', 40,
        'El enlace contiene "@" antes del dominio, un truco para engañar sobre el sitio real.',
        'The link contains "@" before the host, a trick to disguise the real site.',
        'phishing_link'));
    }
    if (mainBrand && !official && !look && !isOfficialFor(u, mainBrand) && !SHORTENERS.has(u.host)) {
      urlProblems++;
      hits.push(hit('brand_link_mismatch', 40,
        `El mensaje menciona a ${mainBrand.name}, pero el enlace (${u.host}) no pertenece a su dominio oficial.`,
        `The message mentions ${mainBrand.name}, but the link (${u.host}) is not its official domain.`,
        brandCategory(mainBrand)));
    }
    if (mainBrand && SHORTENERS.has(u.host)) {
      hits.push(hit('brand_shortened_link', 25,
        `${mainBrand.name} no envía enlaces acortados para gestiones de su cuenta.`,
        `${mainBrand.name} does not send shortened links for account matters.`,
        brandCategory(mainBrand)));
    }
  }

  // ---------- Credential / OTP / card requests ----------
  const credRequest = anyActive(ctx, RE_CRED_REQUEST);
  if (credRequest && ctx.activeSentences.some((s) => RE_CARD.test(s))) {
    hits.push(hit('card_request', 55,
      'Le piden datos de su tarjeta (número, CVV o vencimiento). Ninguna entidad legítima lo pide por mensaje.',
      'It asks for card details (number, CVV or expiry). No legitimate institution asks for this by message.',
      'credential_theft'));
  }
  if (credRequest && ctx.activeSentences.some((s) => RE_PASSWORD.test(s))) {
    hits.push(hit('password_request', 55,
      'Le piden su usuario o contraseña.',
      'It asks for your username or password.',
      'credential_theft'));
  }
  if (credRequest && ctx.activeSentences.some((s) => RE_OTP_WORD.test(s) && !RE_CARD.test(s))) {
    hits.push(hit('otp_request', 60,
      'Le piden un código, PIN o token. Esos códigos son solo para usted: compartirlos permite robar su cuenta.',
      'It asks for a code, PIN or token. Those codes are only for you; sharing them lets criminals take over your account.',
      'credential_theft'));
  }
  if (anyActive(ctx, RE_WA_CODE)) {
    hits.push(hit('whatsapp_code_hijack', 55,
      'Le piden reenviar un código que "llegó por error": es el método clásico para robar cuentas de WhatsApp.',
      'It asks you to forward a code "sent by mistake": the classic WhatsApp account-hijack trick.',
      'account_takeover'));
  }

  // ---------- Pressure ----------
  if (anyActive(ctx, RE_URGENCY_BLOCK)) {
    hits.push(hit('urgency_block', 35,
      'Amenaza con bloquear o suspender su cuenta para presionarle a actuar rápido.',
      'It threatens to block or suspend your account to pressure you into acting fast.'));
  }
  if (RE_URGENCY_TIME.test(t)) {
    hits.push(hit('urgency_time', 15,
      'Usa lenguaje de urgencia o plazos muy cortos.',
      'It uses urgent language or very short deadlines.'));
  }
  if (anyActive(ctx, RE_VERIFY_LINK)) {
    hits.push(hit('verify_data_link', ctx.urls.length ? 25 : 15,
      'Le pide entrar a un enlace o "verificar/actualizar sus datos".',
      'It asks you to open a link or "verify/update your details".'));
  }
  if (RE_UNUSUAL.test(t)) {
    hits.push(hit('unusual_activity', 15,
      'Menciona "actividad inusual", un gancho frecuente en mensajes falsos.',
      'It mentions "unusual activity", a common hook in fake messages.'));
  }

  // ---------- Scam scripts ----------
  if (RE_CRYPTO_ASSET.test(t) && RE_DOUBLING.test(t) || RE_CRYPTO.test(t) && RE_EXPLICIT_DOUBLING.test(t)) {
    hits.push(hit('crypto_doubling', 65,
      'Promete duplicar dinero o ganancias garantizadas con cripto/inversiones. Eso no existe.',
      'It promises to double your money or guaranteed returns with crypto/investments. That does not exist.',
      'crypto_investment'));
  } else if (RE_DOUBLING.test(t)) {
    hits.push(hit('guaranteed_returns', 40,
      'Promete duplicar dinero o ganancias garantizadas.',
      'It promises doubled money or guaranteed profits.',
      'crypto_investment'));
  }
  const remittance = RE_REMITTANCE.test(t);
  const fee = RE_FEE.test(t);
  if (remittance && RE_RETAINED.test(t) && fee) {
    hits.push(hit('remittance_retained_fee', 65,
      'Dice que una remesa está retenida y pide pagar una comisión para liberarla. Las remesadoras no cobran así.',
      'It claims a remittance is on hold and asks for a fee to release it. Remittance companies do not work this way.',
      'remittance_fee'));
  } else if (fee) {
    hits.push(hit('advance_fee', 40,
      'Le piden pagar una comisión, impuesto o cargo por adelantado para recibir algo.',
      'It asks you to pay a fee, tax or charge up front to receive something.',
      'advance_fee'));
  } else if (remittance && RE_RETAINED.test(t)) {
    hits.push(hit('remittance_retained', 25,
      'Dice que una remesa está retenida o pendiente.',
      'It claims a remittance is held or pending.',
      'remittance_fee'));
  }
  if (RE_PRIZE.test(t)) {
    hits.push(hit('prize_lottery', 30,
      'Anuncia un premio o sorteo en el que usted no participó.',
      'It announces a prize or lottery you did not enter.',
      'prize_lottery'));
  }
  if (RE_JOB.test(t)) {
    // Count independent job-scam indicators; several together are a strong signal.
    const indicators = [RE_JOB_PAY, RE_JOB_TASKS, RE_JOB_FEE, RE_JOB_CONTACT].filter((re) => re.test(t)).length;
    hits.push(hit('fake_job', indicators >= 2 ? 65 : 45,
      'Oferta de trabajo fácil y muy bien pagada, típica de fraudes de empleo.',
      'An easy, unusually well-paid job offer, typical of job scams.',
      'fake_job'));
  }
  const newNumber = RE_NEW_NUMBER.test(t);
  const moneyReq = RE_MONEY_REQUEST.test(t);
  if (newNumber && moneyReq) {
    hits.push(hit('whatsapp_number_swap', 65,
      'Alguien dice tener "nuevo número" y le pide dinero: suplantación de un familiar o amigo.',
      'Someone claims a "new number" and asks for money: impersonation of a friend or relative.',
      'whatsapp_number_swap'));
  } else if (newNumber) {
    hits.push(hit('new_number_claim', 25,
      'Un contacto dice tener número nuevo. Confirme por llamada antes de confiar.',
      'A contact claims a new number. Confirm with a call before trusting it.',
      'whatsapp_number_swap'));
  } else if (moneyReq) {
    hits.push(hit('money_request', 25,
      'Le piden prestar o transferir dinero por mensaje.',
      'It asks you to lend or transfer money by message.',
      'whatsapp_number_swap'));
  }
  if (RE_UNSOLICITED_PAYMENT.test(t)) {
    hits.push(hit('unsolicited_refund', 25,
      'Ofrece un reembolso, bono o beneficio que debe "reclamar" en un enlace.',
      'It offers a refund, bonus or benefit you must "claim" through a link.',
      'phishing_link'));
  }
  if (RE_PACKAGE.test(t)) {
    hits.push(hit('package_held', 25,
      'Dice que un paquete está retenido o pendiente, un pretexto común de fraude.',
      'It claims a package is held or pending, a common scam pretext.',
      'advance_fee'));
  }

  // ---------- Combination boosts ----------
  const ids = new Set(hits.map((h) => h.id));
  if (mainBrand && (ids.has('otp_request') || ids.has('card_request') || ids.has('password_request') || ids.has('urgency_block'))) {
    hits.push(hit('brand_pressure_combo', 25,
      `Combina el nombre de ${mainBrand.name} con presión o solicitud de datos sensibles.`,
      `It combines ${mainBrand.name}'s name with pressure or a request for sensitive data.`,
      brandCategory(mainBrand)));
  }
  if (ids.has('prize_lottery') && (ids.has('advance_fee') || urlProblems > 0 || credRequest)) {
    hits.push(hit('prize_combo', 30,
      'Un premio que exige pagar, dar datos o entrar a un enlace dudoso es un fraude.',
      'A prize that requires paying, sharing data or opening a dubious link is a scam.',
      'prize_lottery'));
  }

  // ---------- Protective / legitimacy indicators ----------
  const protective = ctx.sentences.some(sentenceIsProtective) || RE_SAFETY_CHANNEL.test(t);
  const anyPositive = hits.some((h) => h.weight >= 40);
  if (protective && !anyPositive) {
    hits.push(hit('protective_language', -25,
      'Incluye advertencias típicas de mensajes legítimos (p. ej. "nunca le pediremos su clave", "llame al número al reverso").',
      'It includes warnings typical of legitimate messages (e.g. "we will never ask for your PIN", "call the number on the back").'));
  }
  if (ctx.urls.length > 0 && urlProblems === 0 && ctx.urls.every((u) => isOfficialAny(u) && u.scheme !== 'http')) {
    hits.push(hit('official_domain', -20,
      'Los enlaces apuntan a dominios oficiales conocidos.',
      'Links point to known official domains.'));
  }
  return hits;
}

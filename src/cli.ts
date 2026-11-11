#!/usr/bin/env node
/**
 * CLI: npm run cli -- --to bin4nce.testnet --amount 12 --memo "..." --message "..." [--network testnet] [--from x.testnet] [--json] [--offline] [--lang en]
 */
import { parseArgs } from 'node:util';
import { checkPayment } from './guard/engine.js';
import { createFixtureFetch } from './guard/fixtures.js';
import type { GuardResult, GuardSignal } from './guard/types.js';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c('1');
const dim = c('2');
const red = c('31');
const green = c('32');
const yellow = c('33');
const cyan = c('36');
const bgRed = c('41;97;1');
const bgGreen = c('42;30;1');
const bgYellow = c('43;30;1');

const HELP = `FinanciLab Payment Guard — pre-transaction check for NEAR transfers (read-only, no wallet)

Usage:
  npm run cli -- --to <account> --amount <NEAR> [options]

Options:
  --to, -t        Receiver account id (required)
  --amount, -a    Amount in NEAR (required)
  --from, -f      Sender account id (optional)
  --memo, -m      Payment memo / note
  --message, -M   Originating message (WhatsApp/SMS text or agent instruction)
  --network, -n   testnet | mainnet (default testnet)
  --lang, -l      es | en (default es; both are always in --json)
  --offline       Use built-in fixtures instead of live NEAR RPC
  --json          Print the full JSON result
  --strict        Exit code 2 on deny, 3 on needs_human (for scripts/CI)
  --help, -h      Show this help

Examples:
  npm run cli -- --to bin4nce.testnet --amount 12 --message "Soporte Binance: envíe 12 NEAR para verificar su cuenta"
  npm run cli -- --to alice.testnet --amount 2 --message "Te mando 2 NEAR por la cena"
`;

function icon(s: GuardSignal): string {
  if (s.effect === 'deny') return red('✖');
  if (s.effect === 'needs_human') return yellow('▲');
  if (s.effect === 'trust') return green('✔');
  if (s.effect === 'info') return dim('ℹ');
  return yellow('•');
}

export function renderResult(r: GuardResult, lang: 'es' | 'en'): string {
  const badge =
    r.decision === 'deny'
      ? bgRed(lang === 'es' ? ' BLOQUEAR ' : ' DENY ')
      : r.decision === 'needs_human'
        ? bgYellow(lang === 'es' ? ' REVISIÓN HUMANA ' : ' HUMAN REVIEW ')
        : bgGreen(lang === 'es' ? ' PERMITIR ' : ' ALLOW ');
  const other: 'es' | 'en' = lang === 'es' ? 'en' : 'es';
  const f = r.facts;
  const yes = lang === 'es' ? 'sí' : 'yes';
  const no = 'no';
  const unknown = lang === 'es' ? 'desconocido' : 'unknown';
  const lines = [
    '',
    `${badge}  ${bold(`${lang === 'es' ? 'Riesgo' : 'Risk'} ${r.riskScore}/100`)}  ${dim(`(${r.decision})`)}`,
    '',
    bold(r.summary[lang]),
    dim(r.summary[other]),
    '',
    bold(lang === 'es' ? 'Motivos:' : 'Reasons:'),
    ...r.reasons.map((s) => `  ${icon(s)} ${s[lang]}\n    ${dim(`${s.id} · ${s.effect}${s.weight ? ` · ${s.weight > 0 ? '+' : ''}${s.weight}` : ''} · ${s[other]}`)}`),
    '',
    bold(lang === 'es' ? `Datos on-chain (${f.network}):` : `On-chain facts (${f.network}):`),
    `  ${lang === 'es' ? 'Cuenta' : 'Account'}: ${cyan(f.accountId)} ${dim(`[${f.kind}]`)}`,
    `  ${lang === 'es' ? 'Existe' : 'Exists'}: ${f.exists == null ? unknown : f.exists ? yes : no}` +
      (f.exists ? `   ${lang === 'es' ? 'Saldo' : 'Balance'}: ${f.balanceNear} NEAR   ${lang === 'es' ? 'Contrato' : 'Contract'}: ${f.isContract ? yes : no}` : ''),
    ...(f.keys ? [`  ${lang === 'es' ? 'Llaves' : 'Keys'}: ${f.keys.total} (${f.keys.fullAccess} full-access, ${f.keys.functionCall} function-call)`] : []),
    `  ${lang === 'es' ? 'Creada' : 'Created'}: ${f.createdAt ?? unknown}   ${lang === 'es' ? 'Txs recientes' : 'Recent txns'}: ${f.recentTxCount ?? unknown}   ${lang === 'es' ? 'Última actividad' : 'Last active'}: ${f.lastActiveAt ?? unknown}`,
    `  ${dim(f.explorerUrl)}`,
    ...(f.errors.length ? [`  ${dim((lang === 'es' ? 'Avisos de datos: ' : 'Data warnings: ') + f.errors.join(' | '))}`] : []),
    '',
    bold(lang === 'es' ? 'Consejo:' : 'Advice:') + ' ' + r.advice[lang],
    bold(lang === 'es' ? 'Respuesta segura sugerida:' : 'Suggested safe reply:') + ' ' + dim(`"${r.safeReply[lang]}"`),
    '',
    dim('FinanciLab Payment Guard · read-only NEAR RPC · no wallet, no keys, nothing signed'),
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const { values } = parseArgs({
    options: {
      to: { type: 'string', short: 't' },
      amount: { type: 'string', short: 'a' },
      from: { type: 'string', short: 'f' },
      memo: { type: 'string', short: 'm' },
      message: { type: 'string', short: 'M' },
      network: { type: 'string', short: 'n', default: 'testnet' },
      lang: { type: 'string', short: 'l', default: 'es' },
      offline: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });
  if (values.help || !values.to || !values.amount) {
    process.stdout.write(HELP);
    process.exit(values.help ? 0 : 1);
  }
  const network = values.network === 'mainnet' ? 'mainnet' : 'testnet';
  const result = await checkPayment(
    { receiver: values.to, amountNear: values.amount, sender: values.from, memo: values.memo, message: values.message, network },
    values.offline ? { fetch: createFixtureFetch() } : {},
  );
  if (values.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else process.stdout.write(renderResult(result, values.lang === 'en' ? 'en' : 'es'));
  if (values.strict) process.exitCode = result.decision === 'deny' ? 2 : result.decision === 'needs_human' ? 3 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

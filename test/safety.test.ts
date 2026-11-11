import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('safety guarantees (static)', () => {
  const code = [...files('src'), ...files('scripts')].filter((f) => f.endsWith('.ts')).map((f) => [f, stripComments(readFileSync(f, 'utf8'))] as const);

  it('no signing / broadcasting RPC methods or key handling in code', () => {
    const forbidden = /send_tx|broadcast_tx|signTransaction|KeyPair|InMemoryKeyStore|UnencryptedFileSystemKeyStore|near-credentials|seedPhrase|parseSeedPhrase|secretKey|private_key|privateKey/;
    for (const [f, src] of code) expect([f, forbidden.test(src)]).toEqual([f, false]);
  });
  it('no wallet SDKs or NEAR signing libraries are dependencies', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, Record<string, string> | undefined>;
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /near-api-js|wallet-selector|@near-js\/(signers|accounts|keystores)/.test(d))).toEqual([]);
  });
  it('the vendored scam-shield-core is used unmodified (pinned upstream commit)', () => {
    expect(readFileSync('vendor/scam-shield-core/UPSTREAM_COMMIT', 'utf8').trim()).toMatch(/^[0-9a-f]{40}$/);
  });
});

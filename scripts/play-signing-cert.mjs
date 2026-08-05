import { JWT } from 'file:///Z:/macro-app/node_modules/google-auth-library/build/src/index.js';
import { readFileSync } from 'fs';

const PKG = 'fit.ignia.app';
const key = JSON.parse(readFileSync('Z:/macro-app/apps/mobile/credentials/play-service-account.json', 'utf8'));
const client = new JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;

for (const vc of [6, 4]) {
  try {
    const r = await client.request({ url: `${base}/generatedApks/${vc}` });
    console.log(`\n===== versionCode ${vc} =====`);
    const groups = r.data.generatedApks ?? [];
    console.log('signing-key groups:', groups.length);
    for (const g of groups) {
      console.log('  certificateSha256Hash:', g.certificateSha256Hash);
      const names = [
        ...(g.generatedSplitApks ?? []).map(a => `split:${a.moduleName}/${a.splitId || 'base'}`),
        ...(g.generatedAssetPackSlices ?? []).map(a => `slice:${a.moduleName}`),
        g.generatedUniversalApk ? 'universal' : null,
        g.generatedStandaloneApks ? 'standalone' : null,
      ].filter(Boolean);
      console.log('    artifacts:', names.slice(0, 8).join(', '), names.length > 8 ? `(+${names.length - 8})` : '');
    }
  } catch (e) {
    console.log(`\nvc ${vc}: ERROR ${e.response?.status} ${JSON.stringify(e.response?.data?.error?.message ?? e.message)}`);
  }
}

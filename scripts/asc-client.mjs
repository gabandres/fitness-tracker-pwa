/**
 * Minimal App Store Connect API client.
 *
 * Auth is a short-lived ES256 JWT signed with the `.p8` private key — no
 * password, no 2FA, which is what makes ASC scriptable at all. The key file
 * is read from disk and never logged; keep it out of the repo (this one is
 * public).
 *
 * Config comes from CLAUDE.local.md's recorded locations, overridable by env:
 *   ASC_KEY_PATH   path to AuthKey_<KEYID>.p8
 *   ASC_KEY_ID     the key id (also embedded in the filename)
 *   ASC_ISSUER_ID  the account's issuer UUID (console only, not in the .p8)
 */
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { request } from 'node:https';

export const APP_ID = '6788589414';

const KEY_PATH =
  process.env.ASC_KEY_PATH ?? 'C:/Users/gabri/Downloads/AuthKey_47Z9RY8MT5.p8';
const KEY_ID = process.env.ASC_KEY_ID ?? '47Z9RY8MT5';
const ISSUER_ID = process.env.ASC_ISSUER_ID ?? '69a6de88-6f9e-47e3-e053-5b8c7c11a4d1';

const HOST = 'api.appstoreconnect.apple.com';

let cached = null;
/** Apple caps token lifetime at 20 minutes; 10 leaves room for slow uploads. */
function token() {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - now > 60) return cached.value;
  const exp = now + 600;
  const value = jwt.sign(
    { iss: ISSUER_ID, aud: 'appstoreconnect-v1', exp },
    readFileSync(KEY_PATH),
    { algorithm: 'ES256', header: { alg: 'ES256', kid: KEY_ID, typ: 'JWT' } },
  );
  cached = { value, exp };
  return value;
}

/** JSON request against the ASC API. Throws with Apple's error detail, which
 *  is far more useful than the status code alone (permissions problems in
 *  particular arrive as a readable `detail`). */
export function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = request(
      {
        host: HOST,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token()}`,
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            let detail = data;
            try {
              detail = JSON.parse(data)
                .errors.map((e) => `${e.title}: ${e.detail}`)
                .join('; ');
            } catch {
              /* non-JSON error body — keep it raw */
            }
            reject(new Error(`${method} ${path} → ${res.statusCode}: ${detail}`));
            return;
          }
          resolve(data ? JSON.parse(data) : null);
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Reserve → PUT → commit → poll, for one screenshot into any screenshot set
 * (a version localization's, or a custom product page localization's — the
 * resource is the same either way).
 *
 * Apple processes asynchronously, so COMPLETE is the only proof it worked;
 * returning early on a 200 would report success for frames that silently
 * never appear on the listing.
 */
export async function uploadScreenshot(setId, buffer, fileName) {
  const reservation = await api('POST', '/v1/appScreenshots', {
    data: {
      type: 'appScreenshots',
      attributes: { fileSize: buffer.length, fileName },
      relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } },
    },
  });

  const id = reservation.data.id;
  for (const op of reservation.data.attributes.uploadOperations) {
    await uploadChunk(op, buffer.subarray(op.offset, op.offset + op.length));
  }

  const { createHash } = await import('node:crypto');
  await api('PATCH', `/v1/appScreenshots/${id}`, {
    data: {
      type: 'appScreenshots',
      id,
      attributes: {
        uploaded: true,
        sourceFileChecksum: createHash('md5').update(buffer).digest('hex'),
      },
    },
  });

  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await api('GET', `/v1/appScreenshots/${id}`);
    const state = res.data.attributes.assetDeliveryState;
    if (state?.state === 'COMPLETE') return id;
    if (state?.errors?.length) {
      throw new Error(`${fileName}: ${state.errors.map((e) => e.description).join('; ')}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`${fileName}: still processing after 60s`);
}

/** Raw byte upload to a pre-signed asset URL from a reservation. These are
 *  NOT api.appstoreconnect.apple.com and must not carry the JWT. */
export function uploadChunk(operation, buffer) {
  const url = new URL(operation.url);
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(
      (operation.requestHeaders ?? []).map((h) => [h.name, h.value]),
    );
    const req = request(
      {
        host: url.host,
        path: url.pathname + url.search,
        method: operation.method,
        headers: { ...headers, 'Content-Length': buffer.length },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () =>
          res.statusCode >= 400
            ? reject(new Error(`upload → ${res.statusCode}: ${data.slice(0, 200)}`))
            : resolve(),
        );
      },
    );
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Auth } from '@angular/fire/auth';
import { parseSseFrames, type SseEvent } from '@macrolog/core';
import { environment } from '../../environments/environment';

/**
 * Names of every first-party Cloud Function the client invokes.
 *
 * Centralising them buys two things: call sites get autocomplete + typo
 * protection, and the full client → functions surface is greppable from
 * one place (handy when a function is renamed or retired on the server).
 *
 * The Stripe extension endpoint is namespaced at runtime
 * (`ext-<instance>-createPortalLink`), so it can't be a literal here —
 * `call()` still accepts it because the parameter widens to `string`.
 */
export type CallableName =
  // AI / food data path
  | 'analyzePhoto'
  | 'searchFoods'
  | 'getFoodDetail'
  | 'importRecipe'
  | 'generateWeeklyReport'
  // onRequest SSE endpoint (the AI coach) — invoked via `stream()`, not `call()`
  | 'consultationStream'
  // account / GDPR
  | 'deleteAccount'
  | 'exportUserData'
  | 'checkAccessStatus'
  // public profile slug
  | 'claimPublicSlug'
  | 'releasePublicSlug'
  // admin console
  | 'bootstrapAdmin'
  | 'setAdminClaims'
  | 'listUsers'
  | 'getPlatformStats'
  | 'getRecentActivity'
  | 'getAuditLogs'
  | 'adminSuspendUser'
  | 'adminDeleteUser'
  | 'adminResetPassword'
  | 'adminOverridePlan'
  | 'adminSetCompedEmail'
  | 'adminResetQuotas'
  | 'adminExportData'
  | 'adminGetUserDetails'
  | 'startImpersonation'
  | 'stopImpersonation';

/**
 * The single seam between the app and Cloud Functions callables.
 *
 * `Functions` is injected once, here, instead of in every service that
 * needs to call a function. Each call collapses the
 * `httpsCallable(...)` → `await fn(payload)` → `.data` dance into one
 * line, and this becomes the one place to add cross-cutting behaviour
 * later (error mapping, telemetry, retry) without touching call sites.
 *
 * Generic order mirrors `httpsCallable<Req, Res>` so migrating a call
 * site is a mechanical rewrite. `Res` is returned unwrapped — callers
 * index into it for `.data`-nested shapes (e.g. `{ hits }`, `{ csv }`).
 */
@Injectable({ providedIn: 'root' })
export class CallableGateway {
  private readonly functions = inject(Functions);
  private readonly auth = inject(Auth);

  call<Req = void, Res = unknown>(
    // `CallableName | (string & {})` keeps literal autocomplete for the
    // known names while still admitting the runtime-namespaced Stripe
    // extension endpoint.
    name: CallableName | (string & {}),
    payload?: Req,
  ): Promise<Res> {
    const fn = httpsCallable<Req, Res>(this.functions, name);
    return fn(payload as Req).then((result) => result.data);
  }

  /**
   * Streaming sibling of {@link call} for onRequest SSE endpoints (the AI
   * coach). Owns the transport the callable seam otherwise hides — the
   * same-region gen2 URL, ID-token auth, the POST, and byte→SSE-frame
   * decoding (via the shared core `parseSseFrames`) — so callers assemble a
   * pure payload and interpret the yielded frames' `event` names.
   *
   * Throws {@link CallableStreamError} when the endpoint rejects BEFORE any
   * SSE bytes (no auth / non-2xx / no body); its `.code` carries the server's
   * JSON `{ code }` so the caller can map it to a domain error. In-stream
   * `error` frames are yielded like any other for the caller to interpret.
   */
  async *stream(
    name: CallableName | (string & {}),
    payload: unknown,
  ): AsyncGenerator<SseEvent, void, void> {
    const user = this.auth.currentUser;
    // 'UNAUTHENTICATED' matches ErrorCode.UNAUTHENTICATED (the transport-level
    // code the onCall functions use), so callers map it uniformly.
    if (!user) throw new CallableStreamError('UNAUTHENTICATED');
    const idToken = await user.getIdToken();

    const url = `https://us-central1-${environment.firebase.projectId}.cloudfunctions.net/${name}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(payload),
    });

    if (!res.ok || !res.body) {
      // Preamble failure (auth / rate-limit / quota / bad payload): the server
      // sent a JSON `{ code }` before any stream bytes.
      let code: string | undefined;
      try { code = (await res.json())?.code; } catch { /* non-JSON body */ }
      throw new CallableStreamError(code);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseFrames(buf);
      buf = rest;
      yield* events;
    }
  }
}

/**
 * Raised by {@link CallableGateway.stream} when a streaming endpoint fails its
 * preamble (no auth, non-2xx, or missing body) before any SSE bytes. `code`
 * carries the server's typed `{ code }` when present (undefined otherwise).
 */
export class CallableStreamError extends Error {
  constructor(readonly code: string | undefined) {
    super(code ?? 'callable stream failed');
    this.name = 'CallableStreamError';
  }
}

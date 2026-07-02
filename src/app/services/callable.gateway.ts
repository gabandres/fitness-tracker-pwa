import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

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
  | 'generateWeeklyReport'
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
}

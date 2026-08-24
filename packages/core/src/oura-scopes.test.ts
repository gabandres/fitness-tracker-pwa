import { describe, expect, it } from 'vitest';
import {
  OURA_REQUIRED_SCOPES,
  missingOuraScopes,
  needsOuraScopeUpgrade,
  parseOuraScopes,
} from './oura-scopes';

describe('OURA_REQUIRED_SCOPES', () => {
  /**
   * The other half of this assertion is `functions/test/oura-link.spec.ts`,
   * which pins the same literal on the server's `SCOPE`. Together they are what
   * stops the two drifting: a scope added on one side only is either a prompt
   * nobody gets or a prompt everybody gets forever.
   */
  it('is exactly ["workout","daily"] — mirrors SCOPE in functions/src/oura-link.ts', () => {
    expect([...OURA_REQUIRED_SCOPES]).toEqual(['workout', 'daily']);
  });
});

describe('parseOuraScopes', () => {
  it('splits the space-delimited form OAuth 2 specifies', () => {
    expect(parseOuraScopes('workout daily heartrate')).toEqual(['workout', 'daily', 'heartrate']);
  });

  it('reads a single bare scope — what every user connected today has stored', () => {
    expect(parseOuraScopes('workout')).toEqual(['workout']);
  });

  it('tolerates commas and stray whitespace', () => {
    expect(parseOuraScopes('  workout,  daily ')).toEqual(['workout', 'daily']);
  });

  it('lowercases, so a provider echoing "Workout" still matches', () => {
    expect(parseOuraScopes('Workout')).toEqual(['workout']);
  });

  it('returns nothing for null, undefined or empty', () => {
    expect(parseOuraScopes(null)).toEqual([]);
    expect(parseOuraScopes(undefined)).toEqual([]);
    expect(parseOuraScopes('')).toEqual([]);
    expect(parseOuraScopes('   ')).toEqual([]);
  });
});

describe('missingOuraScopes', () => {
  it('is empty when the grant covers everything required', () => {
    expect(missingOuraScopes('workout daily')).toEqual([]);
    expect(missingOuraScopes('daily workout heartrate')).toEqual([]);
  });

  it('names what is absent', () => {
    expect(missingOuraScopes('daily')).toEqual(['workout']);
    expect(missingOuraScopes('workout')).toEqual(['daily']);
  });
});

describe('needsOuraScopeUpgrade', () => {
  it('is false for a grant that already covers what Ignia reads', () => {
    expect(needsOuraScopeUpgrade('workout daily')).toBe(false);
  });

  it('is true for a grant missing a required scope', () => {
    expect(needsOuraScopeUpgrade('daily heartrate')).toBe(true);
  });

  /** THE live case, not a hypothetical: everyone who linked before 2026-08-24
   *  holds `workout` alone, and must be told to reconnect rather than shown an
   *  empty sleep row. */
  it('flags every user who connected under the workout-only grant', () => {
    expect(needsOuraScopeUpgrade('workout')).toBe(true);
    expect(missingOuraScopes('workout')).toEqual(['daily']);
  });

  it('is FALSE for an unknown grant, on purpose', () => {
    // A document written before the `scope` field existed is not evidence that
    // the user granted nothing. Prompting here would deliver a false alarm to
    // people whose integration works, which is how prompts get ignored.
    expect(needsOuraScopeUpgrade(undefined)).toBe(false);
    expect(needsOuraScopeUpgrade(null)).toBe(false);
    expect(needsOuraScopeUpgrade('')).toBe(false);
  });

  /**
   * The scenario this whole module exists for, written as a test so the
   * behaviour is pinned before the feature that needs it lands: a user who
   * connected when `workout` was the only scope, after Ignia starts reading
   * sleep too.
   */
  it('does not flag a grant that carries MORE than Ignia asks for', () => {
    // A user who once approved a wider set is fully covered; re-prompting them
    // would be a reconnect that changes nothing.
    expect(needsOuraScopeUpgrade('workout daily heartrate spo2')).toBe(false);
  });
});

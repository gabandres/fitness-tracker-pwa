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
  it('is exactly ["workout"] — mirrors SCOPE in functions/src/oura-link.ts', () => {
    expect([...OURA_REQUIRED_SCOPES]).toEqual(['workout']);
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
    expect(missingOuraScopes('workout')).toEqual([]);
    expect(missingOuraScopes('workout daily')).toEqual([]);
  });

  it('names what is absent', () => {
    expect(missingOuraScopes('daily')).toEqual(['workout']);
  });
});

describe('needsOuraScopeUpgrade', () => {
  it('is false for a grant that already covers what Ignia reads', () => {
    expect(needsOuraScopeUpgrade('workout')).toBe(false);
  });

  it('is true for a grant missing a required scope', () => {
    expect(needsOuraScopeUpgrade('daily heartrate')).toBe(true);
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
  it('would flag a workout-only grant once sleep is added to the required set', () => {
    const required = ['workout', 'daily'];
    const have = new Set(parseOuraScopes('workout'));
    expect(required.filter((s) => !have.has(s))).toEqual(['daily']);
  });
});

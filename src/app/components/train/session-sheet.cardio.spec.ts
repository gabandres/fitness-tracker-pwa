import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { vi } from 'vitest';
import { LucideAngularModule, HelpCircle, StickyNote, Timer, Check, Trash2, Plus, X } from 'lucide-angular';
import { provideTranslocoConfig } from '../../i18n/transloco.providers';
import { WorkoutSessionSheetComponent } from './session-sheet.component';
import { FitnessStore } from '../../services/fitness-store.service';
import { WorkoutStore } from '../../services/workout-store.service';
import { TranslationService } from '../../services/translation.service';
import type { WorkoutSession } from '../../models/workout';

/**
 * The web Train tab must not CRASH on a cardio-carrying session. That is the
 * whole contract — not a port.
 *
 * ## Why this test exists at all
 *
 * Cardio is a `cardio: CardioBlock[]` on `WorkoutSession` (ADR-0025), written
 * only by the Expo app. The Angular logging surfaces are frozen (ADR-0022) and
 * owe no port, so the web will never render a block — but it will absolutely
 * *read* the document, because both apps share one Firestore collection and
 * one user can run both. The shared mapper (`@macrolog/core`'s
 * `toWorkoutSession`) copies `cardio` through, so the field arrives in the web
 * domain object whether or not the web model declares it.
 *
 * "Frozen" makes that MORE dangerous, not less: nobody is going to open these
 * components again, and a field the templates never mention is exactly the
 * kind of thing that is assumed harmless until a user with an iPhone opens the
 * website and gets a blank sheet. The failure would be silent here and loud
 * there.
 *
 * ## Why the sheet and not the tab
 *
 * `editingSession` is the one input that takes a whole session from outside,
 * so it is the shortest path to "web code renders this object". The history
 * list above it reads the same objects through the same store signal; if the
 * sheet — which touches every field a session has — survives, the list does.
 *
 * The session below is deliberately the awkward one: **zero exercises**, which
 * on this platform only happens when the effort was cardio. A strength session
 * that merely carries a block would exercise the normal path and prove less.
 */

/** A session as the Expo app writes it: a run, logged alone. */
function cardioOnlySession(): WorkoutSession {
  return {
    id: 'sess-cardio',
    status: 'completed',
    templateName: 'Easy run',
    date: new Date('2026-08-24T12:00:00Z'),
    durationMin: 41,
    exercises: [],
    // Not in the web `WorkoutSession` model — which is the point. The cast
    // reproduces what the mapper actually hands the components at runtime.
    cardio: [
      {
        modality: 'run',
        durationSec: 2_460,
        distanceM: 8_050,
        avgHr: 148,
        rpe: 6,
        kcal: 612,
        source: 'health',
        provider: 'oura',
        startedAt: new Date('2026-08-24T11:05:00Z'),
      },
    ],
    createdAt: new Date('2026-08-24T12:00:00Z'),
    updatedAt: new Date('2026-08-24T12:00:00Z'),
  } as unknown as WorkoutSession;
}

@Component({
  standalone: true,
  imports: [WorkoutSessionSheetComponent],
  template: `<app-workout-session-sheet [editingSession]="session()" />`,
})
class HostComponent {
  readonly session = signal<WorkoutSession | null>(cardioOnlySession());
}

describe('web Train tab, against a session written by the mobile app', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        HostComponent,
        // `app.config.ts` registers these globally; a TestBed gets none of
        // that, and an unregistered <lucide-icon> throws at render — which
        // would fail this test for a reason that has nothing to do with cardio.
        LucideAngularModule.pick({ HelpCircle, StickyNote, Timer, Check, Trash2, Plus, X }),
      ],
      providers: [
        provideTranslocoConfig(),
        {
          provide: WorkoutStore,
          useValue: {
            activeSession: signal(null),
            templates: signal([]),
            // The sheet pulls history for ghosts/PRs; an empty list is the
            // realistic answer for a template-less cardio session.
            getSessionsForTemplate: vi.fn().mockResolvedValue([]),
            updateSession: vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: FitnessStore, useValue: { finishWorkout: vi.fn() } },
        { provide: TranslationService, useValue: { t: (k: string) => k } },
      ],
    }).compileComponents();
  });

  it('opens a cardio-carrying session without throwing', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    // `hydrate()` runs in a microtask and awaits the history fetch, so the
    // first change detection pass is not the whole story — a throw in there
    // would otherwise surface as an unhandled rejection and pass this test.
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();

    const html: string = fixture.nativeElement.textContent ?? '';
    // The header rendered, so the sheet got past `session()` and `headerName()`.
    expect(html).toContain('Easy run');
  });

  it('renders nothing for the cardio itself — a read-only tolerance, not a port', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    // Guards the guard: if the web ever DOES grow a cardio surface, this fails
    // and whoever added it gets told to update ADR-0022 and this file rather
    // than discovering the freeze was quietly abandoned.
    const html: string = fixture.nativeElement.innerHTML;
    expect(html).not.toContain('8050');
    expect(html).not.toContain('612');
  });
});

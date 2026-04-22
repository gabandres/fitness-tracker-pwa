// @vitest-environment jsdom
import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, beforeEach, expect, it, vi } from 'vitest';
import { provideTranslocoConfig } from '../../i18n/transloco.providers';
import { LEDGER_PORT } from '../../ledger/ports/ledger.port';
import { TranslationService } from '../../services/translation.service';
import { OnboardingComponent } from './onboarding.component';

// The Angular 21 vitest runner (@angular/build) auto-inits the test
// environment — calling initTestEnvironment here throws "Cannot set base
// providers because it has already been called".

describe('OnboardingComponent', () => {
  const saveProfile = vi.fn<(...args: any[]) => Promise<void>>().mockResolvedValue(undefined);

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  beforeEach(async () => {
    saveProfile.mockClear();

    await TestBed.configureTestingModule({
      imports: [OnboardingComponent],
      providers: [
        provideTranslocoConfig(),
        TranslationService,
        {
          provide: LEDGER_PORT,
          useValue: {
            profile: signal(null),
            saveProfile,
          },
        },
      ],
    }).compileComponents();
  });

  it('advances to step 2 when step 1 is complete', async () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance as any;
    component.heightFt.set(5);
    component.heightInExtra.set(10);
    component.age.set(32);
    component.sex.set('male');
    component.ageGate.set(true);

    await component.submit();

    expect(component.currentStep()).toBe(2);
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('moves back one step when previousStep is used', async () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance as any;
    component.heightFt.set(5);
    component.heightInExtra.set(10);
    component.age.set(32);
    component.sex.set('male');
    component.ageGate.set(true);
    await component.submit();

    component.previousStep();

    expect(component.currentStep()).toBe(1);
  });

  it('saves only after the final step', async () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance as any;
    const emitSpy = vi.spyOn(component.saved, 'emit');

    component.heightFt.set(5);
    component.heightInExtra.set(10);
    component.age.set(32);
    component.sex.set('male');
    component.ageGate.set(true);
    await component.submit();

    component.activityLevel.set('moderate');
    await component.submit();

    component.pace.set(1);
    component.goalWeight.set(170);
    await component.submit();

    expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      heightIn: 70,
      age: 32,
      sex: 'male',
      activityLevel: 'moderate',
      targetPaceLbsPerWeek: 1,
      goalWeightLbs: 170,
      ageConfirmed: true,
    }));
    expect(emitSpy).toHaveBeenCalledOnce();
  });
});

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { SwUpdate } from '@angular/service-worker';
import { App } from './app';
import { AuthService } from './services/auth.service';
import { FirebaseService } from './services/firebase.service';
import { FitnessStore } from './services/fitness-store.service';
import { PushNotificationService } from './services/push-notification.service';
import { Messaging } from '@angular/fire/messaging';

describe('App', () => {
  beforeEach(async () => {
    // JSDOM doesn't implement matchMedia — App constructor needs it for theme detection.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: AuthService,
          useValue: {
            user: signal(null),
            ready: signal(true),
            isSignedIn: signal(false),
            signInWithGoogle: async () => {},
            signOut: async () => {},
          },
        },
        {
          provide: FirebaseService,
          useValue: {
            profile: signal(null),
            profileCompleted: signal(false),
            ensureUserProfile: async () => {},
            clearProfile: () => {},
            getRecentLogs: async () => [],
            getPresets: async () => [],
            addLog: async () => {},
          },
        },
        {
          provide: FitnessStore,
          useValue: {
            logs: signal([]),
            presets: signal([]),
            profile: signal(null),
            status: signal('idle'),
            error: signal(null),
            tdee: signal({ trueTdee: 2450, newDailyTarget: 1800, weightChangeTrend: 0, source: 'seed' }),
            targetCalories: signal(1800),
            currentWeight: signal(null),
            streak: signal(0),
            weekly: signal(null),
            ema: signal([]),
            trendLabel: signal('—'),
            goalProgress: signal(null),
            todaySummary: signal(null),
            hasLoggedToday: signal(false),
            undoEntry: signal(null),
            webhookApiKey: signal(null),
            weeklyReport: signal(null),
            reportLoading: signal(false),
            refresh: async () => {},
            undoDelete: async () => {},
            generateWebhookApiKey: async () => 'test',
            revokeWebhookApiKey: async () => {},
            toggleTravelMode: async () => {},
            travelMode: signal(false),
            generateWeeklyReport: async () => {},
            measurements: signal([]),
            latestMeasurement: signal(null),
            previousMeasurement: signal(null),
            measurementDeltas: signal(null),
            addMeasurement: async () => {},
            deleteMeasurement: async () => {},
          },
        },
        {
          provide: SwUpdate,
          useValue: { isEnabled: false, versionUpdates: { pipe: () => ({ subscribe: () => {} }) } },
        },
        {
          provide: PushNotificationService,
          useValue: {
            permission: signal('default'),
            fcmToken: signal(null),
            requestPermissionAndGetToken: async () => null,
            onForegroundMessage: () => {},
          },
        },
        {
          provide: Messaging,
          useValue: {},
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the Macro Log heading', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Macro');
    expect(compiled.querySelector('h1')?.textContent).toContain('Log');
  });

  it('should show sign-in when not authenticated', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-sign-in')).toBeTruthy();
  });
});

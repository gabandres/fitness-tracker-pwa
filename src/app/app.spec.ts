import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { App } from './app';
import { AuthService } from './services/auth.service';
import { TranslationService } from './services/translation.service';
import { AdminService } from './services/admin.service';
import { AnalyticsService } from './services/analytics.service';
import { provideTranslocoConfig } from './i18n/transloco.providers';

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
            emailVerified: signal(false),
            signOut: vi.fn(),
          },
        },
        {
          provide: TranslationService,
          useValue: {
            language: signal('en'),
            setTitleKey: vi.fn(),
            t: (k: string) => k,
          },
        },
        // AdminService eagerly injects Auth/Firestore/Functions at field-init
        // time; stub it so the spec needs no Firebase.
        {
          provide: AdminService,
          useValue: {
            impersonating: signal(false),
            stopImpersonating: vi.fn(),
          },
        },
        {
          provide: AnalyticsService,
          useValue: { pageview: vi.fn(), track: vi.fn() },
        },
        provideTranslocoConfig(),
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the landing page at /', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect((fixture.componentInstance as any).route()).toBe('landing');
  });

  it('sends the retired logging routes to the moved page', () => {
    for (const path of ['/app', '/app/', '/history/2026-08-01', '/trends', '/body', '/train', '/onboarding']) {
      window.history.replaceState({}, '', path);
      const fixture = TestBed.createComponent(App);
      expect((fixture.componentInstance as any).route(), path).toBe('retired');
    }
    window.history.replaceState({}, '', '/');
  });
});

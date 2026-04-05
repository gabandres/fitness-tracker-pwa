import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { FirebaseService } from './services/firebase.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        // Stub FirebaseService so the Dashboard child doesn't need a real Firestore.
        {
          provide: FirebaseService,
          useValue: {
            addLog: async () => {},
            getRecentLogs: async () => [],
          },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the page heading', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Fitness Tracker');
  });
});

import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideTranslocoConfig } from '../../i18n/transloco.providers';
import { DeferErrorComponent } from './defer-error.component';

/**
 * This component only ever renders on a failure path (`@defer` → `@error`),
 * so nothing else in the suite will exercise it. Without this spec its first
 * real execution would be in front of a user who is already having a bad time.
 */
describe('DeferErrorComponent', () => {
  let reloads: number;

  beforeEach(async () => {
    reloads = 0;
    await TestBed.configureTestingModule({
      imports: [DeferErrorComponent],
      providers: [
        provideTranslocoConfig(),
        {
          provide: DOCUMENT,
          // Proxy rather than a plain stub: TestBed itself calls into DOCUMENT
          // (querySelectorAll, createElement) to mount the fixture, so
          // replacing it wholesale breaks the harness before the component
          // renders. This delegates everything to the real document and
          // overrides only the one thing under test.
          useValue: new Proxy(document, {
            get(target, prop) {
              if (prop === 'defaultView') {
                return { location: { reload: () => { reloads++; } } };
              }
              const value = Reflect.get(target, prop);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          }),
        },
      ],
    }).compileComponents();
  });

  it('offers a reload rather than failing silently', async () => {
    const fixture = TestBed.createComponent(DeferErrorComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    // role=alert so a screen reader announces it; the whole point is that the
    // user learns something went wrong instead of watching an ellipsis.
    expect(el.querySelector('[role="alert"]')).toBeTruthy();
    expect(el.textContent).toContain('Reload');
  });

  it('reloads the page when the button is clicked', async () => {
    const fixture = TestBed.createComponent(DeferErrorComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('button')?.click();

    expect(reloads).toBe(1);
  });
});

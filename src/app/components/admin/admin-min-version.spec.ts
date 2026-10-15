import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AdminConsole } from './admin-console';
import { AdminMinVersionComponent } from './admin-min-version.component';
import { provideTranslocoConfig } from '../../i18n/transloco.providers';
import { checkMinVersion, liveProductionVersionCode, minVersionRows, versionKey } from './admin-min-version';

/**
 * The admin page's copy of the one rule that can strand the fleet: a minimum
 * above the LIVE store version. The server refuses the same inputs
 * (`functions/test/app-version-min.spec.ts`); this pins the page's reasons.
 */
describe('update-required minimum (admin)', () => {
  const doc = {
    android: { latestVersionCode: 51, where: ['production vc 50', 'alpha vc 51'], productionVersionCode: 50 },
    ios: { latestVersion: '1.2.6', latestBuild: 70, minVersion: '1.2.5' },
  };
  const [android, ios] = minVersionRows(doc);

  it('treats only the production track as live on Android', () => {
    expect(liveProductionVersionCode({ latestVersionCode: 51, where: ['alpha vc 51'] })).toBeNull();
    // A staged production rollout shows in `where` but is not live for most
    // users; only the sync's completed-release field counts.
    expect(liveProductionVersionCode({ latestVersionCode: 52, where: ['production vc 52', 'production vc 50'] })).toBeNull();
    expect(android).toEqual({ platform: 'android', live: 50, newest: 51, min: null });
    expect(ios).toEqual({ platform: 'ios', live: '1.2.6', newest: '1.2.6', min: '1.2.5' });
  });

  it('accepts up to and including the live version', () => {
    expect(checkMinVersion(android, '50')).toEqual({ ok: true, value: 50 });
    expect(checkMinVersion(ios, ' 1.2.6 ')).toEqual({ ok: true, value: '1.2.6' });
  });

  it('refuses above the live version — alpha does not count', () => {
    expect(checkMinVersion(android, '51')).toEqual({ ok: false, error: 'aboveLive', params: { value: 'vc 51', live: 'vc 50' } });
    expect(checkMinVersion(ios, '1.2.7')).toMatchObject({ ok: false, error: 'aboveLive' });
  });

  it('refuses when the live version is unknown, and junk input', () => {
    const [a0, i0] = minVersionRows(null);
    expect(checkMinVersion(a0, '40')).toEqual({ ok: false, error: 'liveUnknown' });
    expect(checkMinVersion(i0, '1.0.0')).toEqual({ ok: false, error: 'liveUnknown' });
    expect(checkMinVersion(android, '')).toEqual({ ok: false, error: 'empty' });
    expect(checkMinVersion(android, '4.5')).toEqual({ ok: false, error: 'invalidAndroid' });
    expect(checkMinVersion(android, '0')).toEqual({ ok: false, error: 'invalidAndroid' });
    expect(checkMinVersion(ios, '1.2.7-beta')).toEqual({ ok: false, error: 'invalidIos' });
  });

  it('versionKey orders like the client', () => {
    expect(versionKey('1.10.0')!).toBeGreaterThan(versionKey('1.9.9')!);
    expect(versionKey(undefined)).toBeNull();
  });
});

describe('AdminMinVersionComponent', () => {
  const doc = { android: { latestVersionCode: 51, where: ['production vc 50', 'alpha vc 51'], productionVersionCode: 50 }, ios: { latestVersion: '1.2.6' } };
  let setMin: ReturnType<typeof vi.fn>;

  async function mount() {
    setMin = vi.fn(async () => true);
    const appVersionDoc = Object.assign(() => doc, { load: vi.fn(async () => undefined) });
    TestBed.configureTestingModule({
      imports: [AdminMinVersionComponent],
      providers: [
        provideTranslocoConfig(),
        { provide: AdminConsole, useValue: { appVersionDoc, running: () => false, setMinAppVersion: setMin } },
      ],
    });
    const f = TestBed.createComponent(AdminMinVersionComponent);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return f;
  }

  const type = async (f: Awaited<ReturnType<typeof mount>>, i: number, value: string) => {
    const input = f.nativeElement.querySelectorAll('input')[i] as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
  };

  it('shows the live store build per platform and no minimum', async () => {
    const f = await mount();
    const text = (f.nativeElement as HTMLElement).textContent!;
    expect(text).toContain('Update required');
    expect(text).toContain('live in store: vc 50');
    expect(text).toContain('newest distributed: vc 51');
    expect(text).toContain('live in store: 1.2.6');
    expect(text.match(/no minimum/g)).toHaveLength(2);
  });

  it('refuses a minimum above the live build with a clear warning, and never calls the server', async () => {
    const f = await mount();
    await type(f, 0, '51');
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('vc 51 is above the live store version (vc 50)');
    const setBtn = el.querySelectorAll('button')[0] as HTMLButtonElement;
    expect(setBtn.disabled).toBe(true);
    setBtn.click();
    expect(setMin).not.toHaveBeenCalled();
  });

  it('sets a minimum at the live build', async () => {
    const f = await mount();
    await type(f, 1, '1.2.6');
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')).toBeNull();
    const buttons = [...el.querySelectorAll('button')].filter((b) => b.textContent!.includes('Set minimum'));
    buttons[1].click();
    expect(setMin).toHaveBeenCalledWith('ios', '1.2.6');
  });
});

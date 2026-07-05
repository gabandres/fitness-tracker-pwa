import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { UiButton } from './button.component';
import { UiIconButton } from './icon-button.component';
import { UiCard } from './card.component';
import { UiSheet } from './sheet.component';
import { UiRing } from './ring.component';
import { UiTabBar, type UiTab } from './tab-bar.component';
import { UiFab } from './fab.component';
import { UiSparkline } from './sparkline.component';
import { UiWeightSheet } from './weight-sheet.component';

/**
 * Internal demo / Storybook-style gallery for v2 primitives.
 * Mounted at `/dev/components`. Not for production users — used to
 * self-review components in isolation across light/dark, every
 * variant + size. Toggle theme via the buttons in the header.
 */
@Component({
  selector: 'ui-dev-gallery',
  standalone: true,
  imports: [
    LucideAngularModule,
    UiButton,
    UiIconButton,
    UiCard,
    UiSheet,
    UiRing,
    UiTabBar,
    UiFab,
    UiSparkline,
    UiWeightSheet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen p-6 md:p-10" style="background: var(--v2-paper); color: var(--v2-ink); font-family: var(--v2-font-sans);">
      <div class="max-w-[900px] mx-auto space-y-10">

        <header class="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 class="v2-h1">v2 component gallery</h1>
            <p class="v2-body-soft mt-1">Internal — primitives reference for the warm-minimal rebuild.</p>
          </div>
          <div class="flex items-center gap-2">
            <ui-button variant="secondary" size="sm" (click)="toggleTheme()">
              <lucide-icon [name]="isDark() ? 'sun' : 'moon'" [size]="16" />
              {{ isDark() ? 'Light' : 'Dark' }}
            </ui-button>
          </div>
        </header>

        <hr class="v2-hr" />

        <!-- Buttons -->
        <section>
          <h2 class="v2-h2 mb-4">Button</h2>
          <div class="flex flex-wrap gap-3">
            <ui-button variant="primary">Primary</ui-button>
            <ui-button variant="secondary">Secondary</ui-button>
            <ui-button variant="ghost">Ghost</ui-button>
            <ui-button variant="destructive">Destructive</ui-button>
            <ui-button variant="primary" [disabled]="true">Disabled</ui-button>
          </div>
          <div class="flex flex-wrap gap-3 mt-3 items-center">
            <ui-button variant="primary" size="sm">Small</ui-button>
            <ui-button variant="primary" size="md">Medium</ui-button>
            <ui-button variant="primary" size="lg">Large</ui-button>
          </div>
          <div class="mt-3">
            <ui-button variant="primary" [block]="true">
              <lucide-icon name="plus" [size]="18" />
              Add food
            </ui-button>
          </div>
        </section>

        <!-- Icon buttons -->
        <section>
          <h2 class="v2-h2 mb-4">Icon button</h2>
          <div class="flex flex-wrap gap-2 items-center">
            <ui-icon-button icon="plus" ariaLabel="Add" />
            <ui-icon-button icon="calendar" ariaLabel="History" />
            <ui-icon-button icon="settings" ariaLabel="Settings" />
            <ui-icon-button icon="x" ariaLabel="Close" />
            <ui-icon-button icon="moon" ariaLabel="Toggle theme" />
            <ui-icon-button icon="trash-2" ariaLabel="Delete" [disabled]="true" />
          </div>
        </section>

        <!-- Cards -->
        <section>
          <h2 class="v2-h2 mb-4">Card</h2>
          <div class="grid gap-3 md:grid-cols-2">
            <ui-card>
              <h3 class="v2-h3">Default card</h3>
              <p class="v2-body-soft mt-1">Bordered, paper-2 background, 24px padding, 16px radius.</p>
            </ui-card>
            <ui-card variant="raised">
              <h3 class="v2-h3">Raised</h3>
              <p class="v2-body-soft mt-1">Elevated with shadow-2, no border.</p>
            </ui-card>
            <ui-card variant="flat">
              <h3 class="v2-h3">Flat</h3>
              <p class="v2-body-soft mt-1">Transparent background — for grouping content without visual weight.</p>
            </ui-card>
            <ui-card variant="accent">
              <h3 class="v2-h3">Accent</h3>
              <p class="v2-body-soft mt-1">Rust-tinted background. Use sparingly — for active state, today highlight.</p>
            </ui-card>
          </div>
        </section>

        <!-- Rings -->
        <section>
          <h2 class="v2-h2 mb-4">Ring</h2>
          <div class="flex flex-wrap gap-6 items-center">
            <ui-ring [value]="1480" [target]="2200" [size]="140" [stroke]="14" ariaLabel="Calories: 1480 of 2200">
              <span class="v2-num text-2xl font-semibold">1,480</span>
              <span class="v2-caption">of 2,200 kcal</span>
            </ui-ring>
            <ui-ring [value]="120" [target]="165" [size]="140" [stroke]="14" tone="sage" ariaLabel="Protein: 120 of 165">
              <span class="v2-num text-2xl font-semibold">120g</span>
              <span class="v2-caption">of 165g protein</span>
            </ui-ring>
            <ui-ring [value]="2400" [target]="2200" [size]="140" [stroke]="14" tone="warn" ariaLabel="Calories over by 200">
              <span class="v2-num text-2xl font-semibold">2,400</span>
              <span class="v2-caption">+200 over</span>
            </ui-ring>
            <ui-ring [value]="0" [target]="2200" [size]="80" [stroke]="8" ariaLabel="No data yet">
              <span class="v2-num text-sm font-semibold">0</span>
            </ui-ring>
          </div>
        </section>

        <!-- Sheet -->
        <section>
          <h2 class="v2-h2 mb-4">Sheet</h2>
          <ui-button variant="primary" (click)="sheetOpen.set(true)">Open sheet</ui-button>
          @if (sheetOpen()) {
            <ui-sheet labelledBy="demo-sheet-title" (close)="sheetOpen.set(false)">
              <h2 id="demo-sheet-title" class="v2-h2">Add food</h2>
              <p class="v2-body-soft mt-2">Demo sheet. Swipe down or tap the backdrop to dismiss.</p>
              <div class="mt-5 flex gap-2">
                <ui-button variant="primary" [block]="true" (click)="sheetOpen.set(false)">Save</ui-button>
                <ui-button variant="ghost" (click)="sheetOpen.set(false)">Cancel</ui-button>
              </div>
            </ui-sheet>
          }
        </section>

        <!-- Sparkline -->
        <section>
          <h2 class="v2-h2 mb-4">Sparkline</h2>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ui-card variant="flat">
              <p class="v2-caption mb-2">Accent · 14 pts</p>
              <ui-sparkline [values]="sparkAccent" tone="accent" [width]="220" [height]="48" />
            </ui-card>
            <ui-card variant="flat">
              <p class="v2-caption mb-2">Sage · 7 pts</p>
              <ui-sparkline [values]="sparkSage" tone="sage" [width]="220" [height]="48" />
            </ui-card>
            <ui-card variant="flat">
              <p class="v2-caption mb-2">Empty</p>
              <ui-sparkline [values]="sparkEmpty" tone="ink" [width]="220" [height]="48" />
            </ui-card>
          </div>
        </section>

        <!-- Weight sheet -->
        <section>
          <h2 class="v2-h2 mb-4">Weight sheet</h2>
          <ui-button variant="primary" (click)="weightOpen.set(true)">Open weight sheet</ui-button>
          <ui-weight-sheet
            [open]="weightOpen()"
            (close)="weightOpen.set(false)" />
        </section>

        <!-- Tab bar -->
        <section>
          <h2 class="v2-h2 mb-4">Tab bar (mobile only)</h2>
          <p class="v2-caption mb-3">Visible at &lt;768px viewport. Resize the window to see it dock to the bottom.</p>
          <ui-card variant="flat">
            <p class="v2-body-soft">Active: <span class="v2-num">{{ activeTab() }}</span></p>
          </ui-card>
        </section>

        <hr class="v2-hr" />

        <p class="v2-caption text-center">
          Macronaut v2 · primitives gallery · {{ today() }}
        </p>

        <!-- bottom padding so the FAB + tab-bar don't cover the last items -->
        <div class="h-32"></div>
      </div>

      <!-- Tab bar (mobile-only) — fixed bottom -->
      <ui-tab-bar
        [tabs]="tabs"
        [activeId]="activeTab()"
        (select)="activeTab.set($event)" />

      <!-- FAB (mobile-only) — fixed bottom-right -->
      <ui-fab icon="plus" ariaLabel="Add food" (click)="sheetOpen.set(true)" />
    </div>
  `,
})
export class UiDevGallery {
  protected readonly sheetOpen = signal(false);
  protected readonly weightOpen = signal(false);
  protected readonly sparkAccent: number[] = [180, 179.4, 178.8, 179.1, 178, 177.6, 176.9, 176.5, 175.8, 175.4, 175, 174.7, 174.2, 173.8];
  protected readonly sparkSage: number[] = [3200, 2800, 3100, 2950, 3050, 2700, 3300];
  protected readonly sparkEmpty: number[] = [];
  protected readonly isDark = signal(
    document.documentElement.getAttribute('data-theme') === 'dark',
  );
  protected readonly activeTab = signal<string>('today');
  protected readonly tabs: UiTab[] = [
    { id: 'today', label: 'Today', icon: 'circle-dot' },
    { id: 'trends', label: 'Trends', icon: 'trending-up' },
    { id: 'body', label: 'Body', icon: 'activity' },
  ];

  protected readonly today = (): string =>
    new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  protected toggleTheme(): void {
    const next = this.isDark() ? null : 'dark';
    if (next) document.documentElement.setAttribute('data-theme', next);
    else document.documentElement.removeAttribute('data-theme');
    this.isDark.set(!this.isDark());
  }
}

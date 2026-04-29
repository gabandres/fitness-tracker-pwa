import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { V2Button } from './button.component';
import { V2IconButton } from './icon-button.component';
import { V2Card } from './card.component';
import { V2Sheet } from './sheet.component';
import { V2Ring } from './ring.component';
import { V2TabBar, type V2Tab } from './tab-bar.component';
import { V2Fab } from './fab.component';

/**
 * Internal demo / Storybook-style gallery for v2 primitives.
 * Mounted at `/dev/components` while the v2 rebuild is in flight
 * (Weeks 1-6). Not for production users — used to self-review
 * components in isolation across light/dark, every variant + size.
 *
 * Toggle theme via the buttons in the header to inspect dark.
 * Toggle ?ui=v2 in the URL to compare v1 chrome (won't be visible
 * here since this surface is v2-only by definition).
 */
@Component({
  selector: 'v2-dev-gallery',
  standalone: true,
  imports: [
    LucideAngularModule,
    V2Button,
    V2IconButton,
    V2Card,
    V2Sheet,
    V2Ring,
    V2TabBar,
    V2Fab,
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
            <v2-button variant="secondary" size="sm" (click)="toggleTheme()">
              <lucide-icon [name]="isDark() ? 'sun' : 'moon'" [size]="16" />
              {{ isDark() ? 'Light' : 'Dark' }}
            </v2-button>
          </div>
        </header>

        <hr class="v2-hr" />

        <!-- Buttons -->
        <section>
          <h2 class="v2-h2 mb-4">Button</h2>
          <div class="flex flex-wrap gap-3">
            <v2-button variant="primary">Primary</v2-button>
            <v2-button variant="secondary">Secondary</v2-button>
            <v2-button variant="ghost">Ghost</v2-button>
            <v2-button variant="destructive">Destructive</v2-button>
            <v2-button variant="primary" [disabled]="true">Disabled</v2-button>
          </div>
          <div class="flex flex-wrap gap-3 mt-3 items-center">
            <v2-button variant="primary" size="sm">Small</v2-button>
            <v2-button variant="primary" size="md">Medium</v2-button>
            <v2-button variant="primary" size="lg">Large</v2-button>
          </div>
          <div class="mt-3">
            <v2-button variant="primary" [block]="true">
              <lucide-icon name="plus" [size]="18" />
              Add food
            </v2-button>
          </div>
        </section>

        <!-- Icon buttons -->
        <section>
          <h2 class="v2-h2 mb-4">Icon button</h2>
          <div class="flex flex-wrap gap-2 items-center">
            <v2-icon-button icon="plus" ariaLabel="Add" />
            <v2-icon-button icon="calendar" ariaLabel="History" />
            <v2-icon-button icon="settings" ariaLabel="Settings" />
            <v2-icon-button icon="x" ariaLabel="Close" />
            <v2-icon-button icon="moon" ariaLabel="Toggle theme" />
            <v2-icon-button icon="trash-2" ariaLabel="Delete" [disabled]="true" />
          </div>
        </section>

        <!-- Cards -->
        <section>
          <h2 class="v2-h2 mb-4">Card</h2>
          <div class="grid gap-3 md:grid-cols-2">
            <v2-card>
              <h3 class="v2-h3">Default card</h3>
              <p class="v2-body-soft mt-1">Bordered, paper-2 background, 24px padding, 16px radius.</p>
            </v2-card>
            <v2-card variant="raised">
              <h3 class="v2-h3">Raised</h3>
              <p class="v2-body-soft mt-1">Elevated with shadow-2, no border.</p>
            </v2-card>
            <v2-card variant="flat">
              <h3 class="v2-h3">Flat</h3>
              <p class="v2-body-soft mt-1">Transparent background — for grouping content without visual weight.</p>
            </v2-card>
            <v2-card variant="accent">
              <h3 class="v2-h3">Accent</h3>
              <p class="v2-body-soft mt-1">Rust-tinted background. Use sparingly — for active state, today highlight.</p>
            </v2-card>
          </div>
        </section>

        <!-- Rings -->
        <section>
          <h2 class="v2-h2 mb-4">Ring</h2>
          <div class="flex flex-wrap gap-6 items-center">
            <v2-ring [value]="1480" [target]="2200" [size]="140" [stroke]="14" ariaLabel="Calories: 1480 of 2200">
              <span class="v2-num text-2xl font-semibold">1,480</span>
              <span class="v2-caption">of 2,200 kcal</span>
            </v2-ring>
            <v2-ring [value]="120" [target]="165" [size]="140" [stroke]="14" tone="sage" ariaLabel="Protein: 120 of 165">
              <span class="v2-num text-2xl font-semibold">120g</span>
              <span class="v2-caption">of 165g protein</span>
            </v2-ring>
            <v2-ring [value]="2400" [target]="2200" [size]="140" [stroke]="14" tone="warn" ariaLabel="Calories over by 200">
              <span class="v2-num text-2xl font-semibold">2,400</span>
              <span class="v2-caption">+200 over</span>
            </v2-ring>
            <v2-ring [value]="0" [target]="2200" [size]="80" [stroke]="8" ariaLabel="No data yet">
              <span class="v2-num text-sm font-semibold">0</span>
            </v2-ring>
          </div>
        </section>

        <!-- Sheet -->
        <section>
          <h2 class="v2-h2 mb-4">Sheet</h2>
          <v2-button variant="primary" (click)="sheetOpen.set(true)">Open sheet</v2-button>
          @if (sheetOpen()) {
            <v2-sheet labelledBy="demo-sheet-title" (close)="sheetOpen.set(false)">
              <h2 id="demo-sheet-title" class="v2-h2">Add food</h2>
              <p class="v2-body-soft mt-2">Demo sheet. Swipe down or tap the backdrop to dismiss.</p>
              <div class="mt-5 flex gap-2">
                <v2-button variant="primary" [block]="true" (click)="sheetOpen.set(false)">Save</v2-button>
                <v2-button variant="ghost" (click)="sheetOpen.set(false)">Cancel</v2-button>
              </div>
            </v2-sheet>
          }
        </section>

        <!-- Tab bar -->
        <section>
          <h2 class="v2-h2 mb-4">Tab bar (mobile only)</h2>
          <p class="v2-caption mb-3">Visible at &lt;768px viewport. Resize the window to see it dock to the bottom.</p>
          <v2-card variant="flat">
            <p class="v2-body-soft">Active: <span class="v2-num">{{ activeTab() }}</span></p>
          </v2-card>
        </section>

        <hr class="v2-hr" />

        <p class="v2-caption text-center">
          Macro Log v2 · primitives gallery · {{ today() }}
        </p>

        <!-- bottom padding so the FAB + tab-bar don't cover the last items -->
        <div class="h-32"></div>
      </div>

      <!-- Tab bar (mobile-only) — fixed bottom -->
      <v2-tab-bar
        [tabs]="tabs"
        [activeId]="activeTab()"
        (select)="activeTab.set($event)" />

      <!-- FAB (mobile-only) — fixed bottom-right -->
      <v2-fab icon="plus" ariaLabel="Add food" (click)="sheetOpen.set(true)" />
    </div>
  `,
})
export class V2DevGallery {
  protected readonly sheetOpen = signal(false);
  protected readonly isDark = signal(
    document.documentElement.getAttribute('data-theme') === 'dark',
  );
  protected readonly activeTab = signal<string>('today');
  protected readonly tabs: V2Tab[] = [
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

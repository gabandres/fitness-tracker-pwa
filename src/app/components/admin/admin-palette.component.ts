import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ADMIN_SECTIONS, AdminShellState, type AdminSection } from './admin-shell.state';
import { AdminDataService } from './admin-data.service';

interface PaletteItem { readonly group: string; readonly label: string; readonly hint: string; readonly run: () => void; }

/**
 * ⌘K / Ctrl+K. Jumps to a section, opens a user by email or uid, or runs a
 * refresh. Users come from the cached list, so the first open after a cold
 * load triggers `loadUsers()`.
 */
@Component({
  selector: 'adm-palette',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shell.paletteOpen()) {
      <div class="adm-palette-scrim" (click)="close()">
        <div class="adm-palette" (click)="$event.stopPropagation()" role="dialog" aria-label="Command palette">
          <input #box type="text" [ngModel]="q()" (ngModelChange)="q.set($event); index.set(0)" placeholder="Jump to a section, find a user, run a command…"
            (keydown.arrowdown)="move(1); $event.preventDefault()" (keydown.arrowup)="move(-1); $event.preventDefault()" (keydown.enter)="runSelected()" (keydown.escape)="close()" />
          <ul>
            @for (it of items(); track it.group + it.label; let i = $index) {
              @if (i === 0 || items()[i - 1].group !== it.group) { <li class="adm-palette-group" style="cursor:default;">{{ it.group }}</li> }
              <li [class.on]="i === index()" (click)="run(it)" (mouseenter)="index.set(i)">
                <span>{{ it.label }}</span><span class="k">{{ it.hint }}</span>
              </li>
            } @empty { <li style="cursor:default;" class="adm-muted">No matches.</li> }
          </ul>
        </div>
      </div>
    }
  `,
})
export class AdminPaletteComponent {
  readonly shell = inject(AdminShellState);
  private readonly data = inject(AdminDataService);
  readonly q = signal('');
  readonly index = signal(0);
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');

  constructor() {
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.toggle(); }
    });
    effect(() => {
      if (this.shell.paletteOpen()) {
        if (this.data.users().length === 0) void this.data.loadUsers();
        queueMicrotask(() => this.box()?.nativeElement.focus());
      }
    });
  }

  toggle(): void { this.shell.paletteOpen.update((v) => !v); this.q.set(''); this.index.set(0); }
  close(): void { this.shell.paletteOpen.set(false); }
  move(d: number): void { const n = this.items().length; if (n) this.index.set((this.index() + d + n) % n); }
  runSelected(): void { const it = this.items()[this.index()]; if (it) this.run(it); }
  run(it: PaletteItem): void { it.run(); this.close(); }

  readonly items = computed<PaletteItem[]>(() => {
    const term = this.q().toLowerCase().trim();
    const sections: PaletteItem[] = ADMIN_SECTIONS
      .filter((s) => !term || s.label.toLowerCase().includes(term) || s.hint.toLowerCase().includes(term))
      .map((s) => ({ group: 'Go to', label: s.label, hint: s.hint, run: () => this.shell.go(s.id as AdminSection) }));
    const commands: PaletteItem[] = [
      { group: 'Commands', label: 'Refresh everything', hint: 'stats · usage · retention · ceilings', run: () => void this.data.loadOverview(true) },
      { group: 'Commands', label: 'Mark all feedback read', hint: 'this browser only', run: () => this.data.markFeedbackSeen(this.data.feedback().map((f) => f.id)) },
    ].filter((c) => !term || c.label.toLowerCase().includes(term));
    const users: PaletteItem[] = term.length >= 2
      ? this.data.users()
        .filter((u) => u.email.toLowerCase().includes(term) || u.displayName.toLowerCase().includes(term) || u.uid.toLowerCase().startsWith(term))
        .slice(0, 8)
        .map((u) => ({ group: 'Users', label: u.email, hint: u.displayName || u.uid.slice(0, 8), run: () => { this.shell.go('users'); this.shell.openUser(u.uid); } }))
      : [];
    return [...sections, ...users, ...commands];
  });
}

import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { FastingComponent } from '../fasting/fasting.component';
import { MeasurementsComponent } from '../measurements/measurements.component';
import { V2Card } from '../ui/card.component';
import { V2IconButton } from '../ui/icon-button.component';

/**
 * v2 Body route — Week-4 transitional. Hosts existing v1 fasting +
 * measurements components inside the v2 chrome (warm-minimal paper
 * background, v2 typography, fixed tab bar from app.ts). Week 5
 * replaces this wholesale with a dedicated weight + fasting +
 * measurements rebuild. Until then, keeping the v1 components live
 * means free-tier users on v2 don't lose body-tab functionality.
 */
@Component({
  selector: 'app-body-v2',
  standalone: true,
  imports: [
    LucideAngularModule,
    FastingComponent,
    MeasurementsComponent,
    V2Card,
    V2IconButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="max-w-[640px] mx-auto px-5 sm:px-6 pb-32 md:pb-12">
      <header class="flex items-start justify-between gap-4 pt-6 pb-2">
        <div>
          <h1 class="v2-h1">Body</h1>
          <p class="v2-caption mt-0.5">Fasting, weight, measurements</p>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <v2-icon-button
            icon="calendar"
            ariaLabel="History"
            (click)="historyRequested.emit()" />
          <v2-icon-button
            icon="settings"
            ariaLabel="Settings"
            (click)="settingsRequested.emit()" />
        </div>
      </header>

      <v2-card variant="default" class="mt-6 block">
        <app-fasting />
      </v2-card>

      <v2-card variant="default" class="mt-4 block">
        <app-measurements />
      </v2-card>

      <v2-card variant="flat" class="mt-4 block">
        <p class="v2-caption">Weight chart and goal-progress card arrive next week.</p>
      </v2-card>
    </section>
  `,
})
export class BodyV2Component {
  readonly historyRequested = output<void>();
  readonly settingsRequested = output<void>();
}

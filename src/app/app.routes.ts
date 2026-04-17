import { Routes } from '@angular/router';

export const routes: Routes = [
  // The app uses signal-based rendering (no <router-outlet>). This
  // catch-all prevents NG04002 ("Cannot match any routes") on URLs
  // like /app while the Angular Router is still bootstrapped.
  { path: '**', children: [] },
];

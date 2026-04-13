import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-terms',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="max-w-[640px] mx-auto">
      <a href="/" class="caption text-xs underline decoration-dotted hover:text-blood">
        ← back to macro log
      </a>

      <div class="mt-6 flex items-center gap-3 mb-1">
        <span class="stamp-mark">policy</span>
        <span class="data-label">terms of use</span>
      </div>
      <h1 class="font-display text-4xl sm:text-5xl leading-[0.95] tracking-tight text-ink">
        Terms of<br/><em class="text-blood">use.</em>
      </h1>
      <p class="caption mt-3 text-xs">last updated 2026-04-12 · short, because you shouldn't need a lawyer to read this.</p>

      <div class="mt-8 prose-field text-ink leading-relaxed">
        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">The deal</h2>
        <p>
          Macro Log is a calorie, protein, and weight tracker with an AI
          coach. By signing in, you agree to use it as intended — a personal
          logging tool — and not to abuse it (scraping, reverse-engineering
          the webhook, attempting to access other users' data, etc).
        </p>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">Not medical advice</h2>
        <p>
          The numbers this app shows (TDEE, target, envelope, coach replies)
          are estimates, not prescriptions. The AI coach is a language model
          trained on public text — treat it like a knowledgeable friend who
          could be wrong, not a doctor or dietitian. Talk to a real human
          professional before making significant dietary changes, especially
          if you have a medical condition, are pregnant, under 18, or
          recovering from an eating disorder.
        </p>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">Your account, your data</h2>
        <p>
          You own your data. You can export it as CSV or delete your account
          at any time from the <a href="/privacy" class="underline">privacy
          page</a>. We keep backups for up to 30 days as part of standard
          Google Cloud Firestore operations; these are not human-accessible
          and are auto-purged.
        </p>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">Availability + changes</h2>
        <p>
          Macro Log runs on Google Cloud. We do our best to keep it up, but
          don't guarantee uptime. We may change features, pricing, or these
          terms — when we do, the footer's "last updated" date will change
          and meaningful changes will be announced in-app.
        </p>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">Liability</h2>
        <p>
          Macro Log is provided "as is." We're not liable for decisions you
          make based on its output, for lost data, or for any indirect harm
          from using the app. To the maximum extent allowed by law, our total
          liability to you is capped at whatever you've paid us in the last
          12 months (which for most users is zero).
        </p>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">Contact</h2>
        <p>
          Email <a href="mailto:macrolog.support&#64;gmail.com" class="underline">macrolog.support&#64;gmail.com</a>
          with anything — bug reports, data-deletion requests, feature
          ideas, or complaints.
        </p>
      </div>
    </section>
  `,
})
export class TermsComponent {}

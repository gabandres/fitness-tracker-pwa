# Monitoring setup

One-time operator task to wire Cloud Monitoring alerts for Ignia. The app
surfaces `/status` for user-facing health; these alerts page the operator when
something invisible to users breaks (scheduler dead, function errors spiking,
Gemini quota being burned).

## Prereqs

- `gcloud` CLI installed and authenticated: `gcloud auth login`
- You're the project owner or have `roles/monitoring.editor` on the project
- A notification channel exists (email / Slack webhook / PagerDuty). If not:

```sh
gcloud beta monitoring channels create \
  --display-name="Ignia oncall" \
  --type=email \
  --channel-labels=email_address=ppesoftware@gmail.com \
  --project=fitness-tracker-gb-1775407101
```

Copy the printed `projects/.../notificationChannels/XXXX` identifier.

## Run

```sh
cd fitness-tracker-pwa
PROJECT_ID=fitness-tracker-gb-1775407101 \
NOTIFICATION_CHANNEL_ID=projects/fitness-tracker-gb-1775407101/notificationChannels/XXXX \
./scripts/monitoring/setup-alerts.sh
```

## What this creates

1. **Cloud Functions — error rate > 5%** over 10 min
2. **statusPulse stale > 30 min** (detects dead scheduler even if `/status` itself is reachable)
3. **analyzePhoto > 500 invocations/hour** (runaway client / Gemini quota burn)

## Re-running

The script creates new policies every run. If you need to re-apply, delete the existing ones first:

```sh
gcloud alpha monitoring policies list --project=$PROJECT_ID
gcloud alpha monitoring policies delete $POLICY_ID --project=$PROJECT_ID
```

## Manual adjustments

Open [Cloud Monitoring Alerting](https://console.cloud.google.com/monitoring/alerting) and tweak thresholds there. The YAML in `setup-alerts.sh` is a starting point, not a source of truth after the first run.

#!/usr/bin/env bash
# One-time Cloud Monitoring alert-policy setup for Macro Log.
#
# Requirements:
#   - gcloud CLI installed + authenticated (`gcloud auth login`)
#   - Project + notification channel created (instructions below)
#
# Usage:
#   PROJECT_ID=fitness-tracker-gb-1775407101 \
#   NOTIFICATION_CHANNEL_ID=projects/fitness-tracker-gb-1775407101/notificationChannels/XXXX \
#   ./setup-alerts.sh
#
# To list existing channels:
#   gcloud beta monitoring channels list --project=$PROJECT_ID
#
# To create a new email channel:
#   gcloud beta monitoring channels create \
#     --display-name="Macro Log oncall" \
#     --type=email --channel-labels=email_address=gabrielandresbermudez@gmail.com \
#     --project=$PROJECT_ID
#
# Channel + all 3 policies were applied 2026-04-19 via the REST API
# (notificationChannels.create + alertPolicies.create) because
# `gcloud beta` wasn't installed. Live channel ID:
#   projects/fitness-tracker-gb-1775407101/notificationChannels/14532171541501133516
# Existing policies:
#   gcloud monitoring policies list --project=$PROJECT_ID
#
# Alerts created by this script (intentionally a small, high-signal set):
#   1. Cloud Functions error rate > 5% over 10 min
#   2. statusPulse scheduled job hasn't fired in 30 min (pulse staleness)
#   3. analyzePhoto invocations > 500/hour (Gemini quota burn / runaway client)

set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to your GCP project id}"
: "${NOTIFICATION_CHANNEL_ID:?Set NOTIFICATION_CHANNEL_ID to projects/<id>/notificationChannels/<channel-id>}"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# ── Policy 1: Cloud Functions error rate ─────────────────────────
cat > "$TMPDIR/functions-errors.yaml" <<EOF
displayName: "Cloud Functions — error rate > 5%"
combiner: OR
notificationChannels:
  - $NOTIFICATION_CHANNEL_ID
conditions:
  - displayName: "error rate >5% for 10m"
    conditionThreshold:
      filter: |
        resource.type = "cloud_function"
        AND metric.type = "cloudfunctions.googleapis.com/function/execution_count"
        AND metric.labels.status != "ok"
      aggregations:
        - alignmentPeriod: 600s
          perSeriesAligner: ALIGN_RATE
          crossSeriesReducer: REDUCE_SUM
      comparison: COMPARISON_GT
      thresholdValue: 0.05
      duration: 600s
EOF

# ── Policy 2: statusPulse staleness ──────────────────────────────
cat > "$TMPDIR/status-stale.yaml" <<EOF
displayName: "Macro Log — statusPulse stale >30m"
combiner: OR
notificationChannels:
  - $NOTIFICATION_CHANNEL_ID
conditions:
  - displayName: "no statusPulse execution in 30m"
    conditionAbsent:
      filter: |
        resource.type = "cloud_function"
        AND resource.labels.function_name = "statusPulse"
        AND metric.type = "cloudfunctions.googleapis.com/function/execution_count"
      aggregations:
        - alignmentPeriod: 300s
          perSeriesAligner: ALIGN_RATE
      duration: 1800s
EOF

# ── Policy 3: analyzePhoto burn ──────────────────────────────────
cat > "$TMPDIR/photo-burn.yaml" <<EOF
displayName: "analyzePhoto — >500 invocations/hour"
combiner: OR
notificationChannels:
  - $NOTIFICATION_CHANNEL_ID
conditions:
  - displayName: "runaway photo calls"
    conditionThreshold:
      filter: |
        resource.type = "cloud_function"
        AND resource.labels.function_name = "analyzePhoto"
        AND metric.type = "cloudfunctions.googleapis.com/function/execution_count"
      aggregations:
        - alignmentPeriod: 3600s
          perSeriesAligner: ALIGN_SUM
      comparison: COMPARISON_GT
      thresholdValue: 500
      duration: 0s
EOF

for policy in functions-errors status-stale photo-burn; do
  echo "Creating alert policy: $policy"
  gcloud alpha monitoring policies create \
    --project="$PROJECT_ID" \
    --policy-from-file="$TMPDIR/$policy.yaml"
done

echo "Done. View policies at https://console.cloud.google.com/monitoring/alerting/policies?project=$PROJECT_ID"

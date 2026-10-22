#!/bin/zsh
# firstvisit.sh <label> <runs> — cold launch, then Train → Trends → Body first visits
U=$(cat /tmp/probe/udid)
for i in $(seq 1 $2); do
  xcrun simctl terminate $U fit.ignia.app 2>/dev/null; xcrun simctl launch $U fit.ignia.app >/dev/null; sleep 9
  n=$(wc -l < /tmp/probe/perf.log)
  (cd /tmp/probe/flows && maestro --device $U test firstvisit.yaml > /tmp/probe/fv-$1.log 2>&1)
  sleep 3
  tail -n +$((n+1)) /tmp/probe/perf.log | grep -o "SUMMARY.*" | awk -v r=$i '{print "run" r, $0}'
done

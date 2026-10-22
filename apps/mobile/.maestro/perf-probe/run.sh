#!/bin/zsh
# run.sh <label> — runs the tab flow, prints the SUMMARY lines it produced
U=$(cat /tmp/probe/udid)
n=$(wc -l < /tmp/probe/perf.log)
cd /tmp/probe/flows && maestro --device $U test ${2:-tabs}.yaml > /tmp/probe/tabs-$1.log 2>&1 || { echo "flow failed"; grep FAILED /tmp/probe/tabs-$1.log | head -3; }
sleep 3
tail -n +$((n+1)) /tmp/probe/perf.log > /tmp/probe/perf-$1.log
grep -o "SUMMARY.*" /tmp/probe/perf-$1.log

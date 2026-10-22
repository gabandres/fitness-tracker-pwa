#!/bin/zsh
set -e
cd /tmp/ig-probe/apps/mobile
npx expo export:embed --platform ios --dev false --minify true --entry-file index.js --bundle-output /tmp/probe/main.js --assets-dest /tmp/probe/assets > /tmp/probe/export.log 2>&1
/tmp/ig-probe/node_modules/hermes-compiler/hermesc/osx-bin/hermesc -emit-binary -O -w -out /tmp/probe/main.jsbundle /tmp/probe/main.js
cp /tmp/probe/main.jsbundle /tmp/probe/Ignia.app/main.jsbundle
codesign --force --deep --sign - /tmp/probe/Ignia.app >/dev/null 2>&1
U=$(cat /tmp/probe/udid)
xcrun simctl terminate $U fit.ignia.app 2>/dev/null || true
xcrun simctl install $U /tmp/probe/Ignia.app
echo rebuilt

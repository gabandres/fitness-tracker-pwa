// babel-preset-expo (SDK 54) auto-includes react-native-worklets/plugin when
// reanimated is installed, which @gorhom/bottom-sheet needs on-device. Made
// explicit so the worklets transform is guaranteed (not relying on the
// no-config default).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 3: плагин обязателен для worklet'ов (spring-анимации дизайн-системы).
    plugins: ['react-native-reanimated/plugin'],
  };
};

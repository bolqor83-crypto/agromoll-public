module.exports = (api) => {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 3: плагин обязателен для работы анимаций на UI-потоке.
    plugins: ['react-native-reanimated/plugin'],
  };
};

module.exports = {
  preset: 'jest-expo',
  // Allowlist: эти пакеты из node_modules надо трансформировать babel'ом,
  // иначе ESM/TS внутри них не парсится jest'ом.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?expo|@expo(-|-cli)?|react-native|@react-native|expo-router|@unimodules|unimodules|react-native-reanimated|react-native-gesture-handler|react-native-safe-area-context|react-native-web|zustand|@agromoll))',
  ],
};

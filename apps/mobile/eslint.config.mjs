import base from '../../eslint.config.base.mjs';

export default [
  ...base,
  {
    // Конфиги Metro/Babel — CommonJS по требованиям инструментов Expo.
    files: ['babel.config.js', 'metro.config.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];

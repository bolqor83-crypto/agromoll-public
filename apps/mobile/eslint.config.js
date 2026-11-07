// eslint-config-expo — классический (eslintrc) конфиг, подключаем его
// в ESLint 9 flat-режиме через FlatCompat.
const { FlatCompat } = require('@eslint/eslintrc');

const compat = new FlatCompat({ baseDirectory: __dirname });

module.exports = [
  ...compat.extends('eslint-config-expo'),
  {
    // dist-e2e — статический экспорт локального E2E-стенда (v0.8.0-F):
    // те же артефакты, что и dist, но с адресом локального API.
    ignores: ['dist/**', 'dist-e2e/**', '.expo/**', 'coverage/**'],
  },
  {
    // Конфиг-файлы сборки — CommonJS с node-глобалами
    files: ['*.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    // Jest-сетап: глобалы jest (v0.6.1-A, рендер-тесты RTL)
    files: ['jest.setup.js'],
    languageOptions: {
      globals: {
        jest: 'readonly',
      },
    },
  },
  {
    // Service worker (v0.6.0-A, ADR-031): глобалы SW-скоупа — self,
    // clients, PushManager-события. Живёт в public/, в бандл Expo
    // попадает как статика (не трансформируется Metro).
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        clients: 'readonly',
        importScripts: 'readonly',
        skipWaiting: 'readonly',
      },
    },
  },
];

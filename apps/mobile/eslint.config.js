// eslint-config-expo — классический (eslintrc) конфиг, подключаем его
// в ESLint 9 flat-режиме через FlatCompat.
const { FlatCompat } = require('@eslint/eslintrc');

const compat = new FlatCompat({ baseDirectory: __dirname });

module.exports = [
  ...compat.extends('eslint-config-expo'),
  {
    ignores: ['dist/**', '.expo/**', 'coverage/**'],
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
];

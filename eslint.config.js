const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'reports/**',
      'week-04-seguridad-privacidad/**',
      'week-05-cliente-cloud/**',
    ],
  },
]);

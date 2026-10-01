/* eslint-disable */
const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

// Integration tests run against the real PostgreSQL test database (pharmacy_test).
module.exports = {
  displayName: 'api-integration',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.int-spec.ts'],
  globalSetup: '<rootDir>/test/integration/global-setup.ts',
  testTimeout: 30000,
  transform: {
    '^.+\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // uuid 14 ships ESM only; let SWC compile it to CommonJS like the sources.
  transformIgnorePatterns: ['/node_modules/(?!uuid/)'],
  coverageDirectory: 'test-output/jest/coverage-integration',
};

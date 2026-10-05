// Shared by jest.config.cts (unit) and jest.integration.config.cts: packages that ship ESM only
// (uuid 14, kysely 0.29, @nestjs/config 12, @nestjs/jwt 12) are compiled to CommonJS by SWC like the sources.
const ESM_PACKAGES = ['uuid', 'kysely', '@nestjs/config', '@nestjs/jwt'];

module.exports = {
  transformIgnorePatterns: [`/node_modules/(?!(${ESM_PACKAGES.join('|')})/)`],
};

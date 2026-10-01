/* Jest setup for libs/ui: axe matcher (ADR-0009, ось Е) and jsdom stand-ins for platform APIs. */
import { toHaveNoViolations } from 'jest-axe';
import './src/testing/platform-polyfills';

expect.extend(toHaveNoViolations);

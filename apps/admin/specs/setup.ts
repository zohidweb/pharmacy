import { toHaveNoViolations } from 'jest-axe';
import '@pharmacy/ui/testing';

expect.extend(toHaveNoViolations);

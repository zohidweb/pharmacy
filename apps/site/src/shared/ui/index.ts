// Server-safe parts only. The motion primitives (client, ADR-0024) are imported from `@/shared/ui/motion`, so pages
// without animation never pull `motion` into their chunks.
export { PageSection, type PageSectionProps } from './PageSection';
export { stateScreenClassName } from './state-screen';

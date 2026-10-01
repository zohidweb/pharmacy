import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';

// NODE_ENV is inlined at build time: the production export contains neither the catalog nor its chunk.
const UiKitCatalog =
  process.env.NODE_ENV === 'production'
    ? null
    : dynamic(() =>
        import('./UiKitCatalog').then((module) => module.UiKitCatalog),
      );

/**
 * Component catalog of libs/ui (ADR-0007: documentation of the kit).
 * Development only: the production static export renders 404 for this route.
 */
export function UiKitPage() {
  if (!UiKitCatalog) {
    notFound();
  }
  return <UiKitCatalog />;
}

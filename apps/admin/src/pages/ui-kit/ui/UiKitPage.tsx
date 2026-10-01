import { notFound } from 'next/navigation';
import { UiKitCatalog } from './UiKitCatalog';

/**
 * Component catalog of libs/ui (ADR-0007: documentation of the kit).
 * Development only: the production static export renders 404 for this route.
 */
export function UiKitPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }
  return <UiKitCatalog />;
}

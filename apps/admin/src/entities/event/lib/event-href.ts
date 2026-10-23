import type { EventTarget } from '@pharmacy/shared-dto';
import { isApiRouteAvailable } from '@/shared/api';
import { routes } from '@/shared/config';

/**
 * Admin screen an event or a queue item leads to; null where the screen's route does not answer in
 * this build (the store card, licenses and versions of offline stores are not on apps/api yet).
 */
export function eventHref(target: EventTarget): string | null {
  switch (target.screen) {
    case 'tenant':
      return routes.company(target.id);
    case 'store':
      return isApiRouteAvailable('stores.get') ? routes.store(target.id) : null;
    case 'billing':
      return routes.invoices();
    case 'services':
      return routes.services();
    case 'licenses':
      return isApiRouteAvailable('licenses.list') ? routes.licenses() : null;
    case 'installations':
      return isApiRouteAvailable('installations.list')
        ? routes.versions()
        : null;
  }
}

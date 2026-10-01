import type { EventTarget } from '@pharmacy/shared-dto';
import { routes } from '@/shared/config';

/** Admin screen an event or a queue item leads to. */
export function eventHref(target: EventTarget): string {
  switch (target.screen) {
    case 'tenant':
      return routes.company(target.id);
    case 'store':
      return routes.store(target.id);
    case 'billing':
      return routes.invoices();
    case 'services':
      return routes.services();
    case 'licenses':
      return routes.licenses();
    case 'installations':
      return routes.versions();
  }
}

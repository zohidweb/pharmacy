import type { UiLocale } from '@pharmacy/shared-dto';
import type { Messages } from './config';

declare module 'use-intl' {
  interface AppConfig {
    Locale: UiLocale;
    Messages: Messages;
  }
}

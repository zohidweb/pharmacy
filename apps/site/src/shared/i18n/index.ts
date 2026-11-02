// load-messages stays out of the barrel on purpose: this barrel re-exports config.ts, which imports both
// dictionaries statically. app/global-error.tsx (a client component) imports '@/shared/i18n/load-messages'
// directly, so its bundle loads one dictionary as a chunk on demand; through the barrel it would carry both.
// Do not "fix" that deep import by moving it here.
export {
  APP_TIME_ZONE,
  getMessages,
  getTranslator,
  isLocale,
  locales,
  type Messages,
} from './config';
export { IntlClientProvider } from './IntlClientProvider';

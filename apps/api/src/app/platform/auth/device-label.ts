// Browser and OS of a sign-in for the operator's list of sessions («Chrome · Windows»): names
// only, no versions, and never the raw user agent, which is not stored. Order matters: Edge, Opera
// and Yandex also say «Chrome», Chrome also says «Safari», Android also says «Linux».
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(e|A|iOS)?\//, 'Edge'],
  [/\b(OPR|Opera)\//, 'Opera'],
  [/\bYaBrowser\//, 'Yandex Browser'],
  [/\b(Firefox|FxiOS)\//, 'Firefox'],
  [/\b(Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bWindows\b/, 'Windows'],
  [/\b(iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

// A user agent is a few hundred characters; anything longer is cut before matching.
const MAX_USER_AGENT_LENGTH = 512;

const first = (
  rules: ReadonlyArray<readonly [RegExp, string]>,
  value: string,
): string | undefined => rules.find(([pattern]) => pattern.test(value))?.[1];

/** «Browser · OS», one of them, or '' when neither is recognized. */
export function deviceLabel(userAgent: string | undefined): string {
  if (!userAgent) return '';
  const value = userAgent.slice(0, MAX_USER_AGENT_LENGTH);
  return [first(BROWSERS, value), first(SYSTEMS, value)]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
}

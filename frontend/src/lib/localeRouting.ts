export type UiLang = 'en' | 'ko';

function stripBase(pathname: string, base: string): string {
  if (base && pathname.startsWith(base)) {
    return pathname.slice(base.length) || '/';
  }
  return pathname;
}

/** Returns the locale prefix segment and the UI language implied by the URL. */
export function detectLocale(
  pathname: string,
  base: string,
): { localePrefix: '' | '/ko'; lang: UiLang } {
  const rest = stripBase(pathname, base);
  if (rest === '/ko' || rest.startsWith('/ko/')) {
    return { localePrefix: '/ko', lang: 'ko' };
  }
  return { localePrefix: '', lang: 'en' };
}

/** Rebuilds the full path (incl. base) for the target language. */
export function buildLocalePath(pathname: string, toLang: UiLang, base: string): string {
  const rest = stripBase(pathname, base);
  // Strip an existing /ko prefix to get the logical path.
  let logical = rest;
  if (rest === '/ko') {
    logical = '/';
  } else if (rest.startsWith('/ko/')) {
    logical = rest.slice('/ko'.length);
  }
  const prefixed = toLang === 'ko' ? `/ko${logical === '/' ? '' : logical}` : logical;
  const normalized = prefixed === '' ? '/' : prefixed;
  return `${base}${normalized}`;
}

import { defineMiddleware } from 'astro:middleware';

const SUPPORTED = ['de', 'en'] as const;
type Locale = (typeof SUPPORTED)[number];

function fromAcceptLanguage(header: string | null): Locale {
  if (!header) return 'de';
  const primary = header.split(',')[0]?.split(';')[0]?.trim().toLowerCase().slice(0, 2);
  return (SUPPORTED as readonly string[]).includes(primary ?? '') ? (primary as Locale) : 'de';
}

export const onRequest = defineMiddleware(({ locals, cookies, request }, next) => {
  const cookie = cookies.get('locale')?.value;
  locals.locale = (SUPPORTED as readonly string[]).includes(cookie ?? '')
    ? (cookie as Locale)
    : fromAcceptLanguage(request.headers.get('Accept-Language'));
  return next();
});

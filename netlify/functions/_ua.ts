/**
 * User-agent classification for the analytics table.
 *
 * The user agent itself is never stored with an event — only this one word is.
 * That is the point: "mobile" is the fact the dashboard needs, and a raw UA
 * string is a fingerprint, so the reduction happens on the way in rather than
 * on the way out.
 *
 * ORDER MATTERS, and it is the only subtle thing here: bots before tablets
 * before mobiles. Googlebot's smartphone crawler sends a UA containing both
 * "Googlebot" and "Mobile"; an Android tablet sends "Android" without "Mobile",
 * while an Android phone sends both. Test the most specific claim first or the
 * launch's traffic graph counts crawlers as real phones — the exact mistake
 * that makes a Reddit launch look twice as successful as it was.
 */
import type { Device } from '../../src/api/contracts.js';

/**
 * Crawlers, previewers and headless browsers. Link unfurlers (Slack, Discord,
 * WhatsApp, Reddit's own) matter more than search bots on launch day: one
 * shared URL can fan out into dozens of hits that never had a person behind
 * them.
 */
const BOT =
  /bot\b|bot\/|robot|spider|crawler|crawling|slurp|archiver|scrapy|wget|curl|python-requests|node-fetch|axios|okhttp|headless|phantomjs|lighthouse|pagespeed|pingdom|uptime|monitor|preview|embedly|facebookexternalhit|whatsapp|telegram|slack|discord|twitterbot|linkedinbot|redditbot|applebot|yandex|baiduspider|duckduckbot|semrush|ahrefs|petalbot|bytespider|gptbot|claude|perplexity|chatgpt/i;

/** No "Mobile" token on Android means a tablet; iPads say so outright. */
const TABLET = /ipad|tablet|playbook|silk|kindle|(?:android(?!.*mobile))/i;

const MOBILE = /mobile|iphone|ipod|android|blackberry|bb10|iemobile|opera mini|opera mobi|windows phone|webos/i;

export function deviceFromUa(ua: string | null | undefined): Device {
  if (typeof ua !== 'string') return 'unknown';
  const value = ua.trim();
  if (value.length === 0) return 'unknown';

  if (BOT.test(value)) return 'bot';
  if (TABLET.test(value)) return 'tablet';
  if (MOBILE.test(value)) return 'mobile';
  return 'desktop';
}

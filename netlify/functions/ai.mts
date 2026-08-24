/**
 * AI endpoints.
 *
 * One function serves all three routes; Netlify's path parameter keeps them on
 * the same warm instance rather than paying a cold start per endpoint.
 */
import type { Config, Context } from '@netlify/functions';
import {
  generateGraffitiWithFallback,
  generateCritiqueWithFallback,
  generateStyleTransformation,
  CURATED_GRAFFITI_PRESETS,
  CURATED_TRANSFORMATIONS,
} from './_ai.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export default async (request: Request, context: Context) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const route = context.params.route;
  let payload: Record<string, any> = {};
  try {
    payload = await request.json();
  } catch {
    /* an empty body just means "use the defaults" */
  }

  try {
    switch (route) {
      case 'graffiti-tag':
        return json(
          await generateGraffitiWithFallback(payload.prompt ?? 'wildstyle', payload.style ?? 'wildstyle')
        );
      case 'critique':
        return json(
          await generateCritiqueWithFallback(payload.objectType ?? 'easel', payload.dominantColor ?? '#FF4D1C')
        );
      case 'transform-style':
        return json(
          await generateStyleTransformation(
            payload.preset ?? 'cyberpunk',
            payload.objectType ?? 'easel',
            payload.customPrompt
          )
        );
      default:
        return json({ error: `Unknown AI route "${route}"` }, 404);
    }
  } catch (error) {
    console.error(`[ai/${route}]`, error);
    // Degrade to the curated response rather than surfacing a 500 mid-session.
    if (route === 'critique') {
      return json({
        exhibitionTitle: 'VIBRATIONS IN LOWER EAST SIDE',
        curatorCritique: 'A bold, kinetic exploration of aerosol velocity and physical gesture.',
        estimatedValue: '$22,000 USD',
        auctionHouse: "SOTHEBY'S CONTEMPORARY STREET",
        vibeTags: ['#AerosolExpressionism', '#NeoGraffiti', '#RawEnergy'],
      });
    }
    return json(route === 'transform-style' ? CURATED_TRANSFORMATIONS.cyberpunk : CURATED_GRAFFITI_PRESETS[0]);
  }
};

export const config: Config = {
  path: '/api/ai/:route',
};

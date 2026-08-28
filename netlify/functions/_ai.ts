/**
 * Gemini-backed AI helpers shared by the Netlify functions and the local dev
 * server. Every entry point falls back to a curated response when the API key
 * is absent or the call fails, so the studio's AI panel always returns
 * something usable rather than erroring.
 */
import { GoogleGenAI, Type } from "@google/genai";

let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!genAIClient && process.env.GEMINI_API_KEY) {
    genAIClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { "User-Agent": "airohub" } },
    });
  }
  return genAIClient;
}

// Fallback curated graffiti concepts
const CURATED_GRAFFITI_PRESETS = [
  {
    title: "NEON PHANTOM",
    tagLine: "Midnight Cyber Drip",
    recommendedPalette: ["#FF3D00", "#06B6D4", "#F59E0B", "#FFFFFF"],
    stencilSymbol: "⚡",
    graffitiText: "PHANTOM",
    styleNotes: "High-contrast aerosol gradients with razor-sharp drip highlights.",
  },
  {
    title: "CROWN OF NY",
    tagLine: "Subway Royalty 1984",
    recommendedPalette: ["#F59E0B", "#FF3D00", "#18181B", "#FFFFFF"],
    stencilSymbol: "👑",
    graffitiText: "KINGS",
    styleNotes: "Fat-cap outlines filled with hot vibrant flare bursts.",
  },
  {
    title: "CYBER REBEL",
    tagLine: "Underground Neon Wave",
    recommendedPalette: ["#EC4899", "#8B5CF6", "#06B6D4", "#FFFFFF"],
    stencilSymbol: "✦",
    graffitiText: "REBEL",
    styleNotes: "Layered stencil misting with glowing chromatic aberration accents.",
  },
  {
    title: "ACID DRAGON",
    tagLine: "Wildstyle Beast",
    recommendedPalette: ["#10B981", "#F59E0B", "#FF3D00", "#18181B"],
    stencilSymbol: "🐉",
    graffitiText: "VENOM",
    styleNotes: "Interlocking arrow geometry with saturated acid spray plumes.",
  },
];

const CURATED_TRANSFORMATIONS: Record<string, any> = {
  cyberpunk: {
    transformedTitle: "NEO-SHINJUKU OVERDRIVE",
    vibe: "Cyberpunk 2099",
    tagLine: "High Tech, Low Life Aerosol",
    accentColor: "#06B6D4",
    secondaryColor: "#EC4899",
    stencilSymbol: "⚡",
    tagText: "CYBERPUNK",
    dripIntensity: 0.8,
    glowRadius: 28,
    curatorNotes: "Electric cyan and neon magenta flares with cybernetic vector grids and chromatic aberration.",
  },
  wildstyle80s: {
    transformedTitle: "BRONX EXPRESS 1984",
    vibe: "Vintage Subway Wildstyle",
    tagLine: "Golden Age Aerosol Masters",
    accentColor: "#FF3D00",
    secondaryColor: "#F59E0B",
    stencilSymbol: "👑",
    tagText: "WILDSTYLE",
    dripIntensity: 1.0,
    glowRadius: 18,
    curatorNotes: "Classic fat-cap bevels, heavy gravity drips, and hot yellow-to-orange fade highlights.",
  },
  banksy: {
    transformedTitle: "THERE IS ALWAYS HOPE",
    vibe: "Urban Stencil Dystopia",
    tagLine: "Guerrilla Street Critique",
    accentColor: "#FF3D00",
    secondaryColor: "#18181B",
    stencilSymbol: "👁",
    tagText: "DREAM",
    dripIntensity: 0.4,
    glowRadius: 8,
    curatorNotes: "High-contrast monochrome stencil layer accented with a single dripping red heart beacon.",
  },
  popart: {
    transformedTitle: "KINETIC BEN-DAY EXPLOSION",
    vibe: "Pop-Art Comic Halftone",
    tagLine: "Lichtenstein Meets Aerosol",
    accentColor: "#F59E0B",
    secondaryColor: "#06B6D4",
    stencilSymbol: "✦",
    tagText: "POW!",
    dripIntensity: 0.3,
    glowRadius: 12,
    curatorNotes: "Bold comic dot matrix screens with punchy saturated primaries and heavy graphic ink strokes.",
  },
  cosmic: {
    transformedTitle: "INTERSTELLAR NEBULA",
    vibe: "Deep Space Aurora",
    tagLine: "Galactic Stardust Mist",
    accentColor: "#8B5CF6",
    secondaryColor: "#06B6D4",
    stencilSymbol: "🚀",
    tagText: "COSMOS",
    dripIntensity: 0.5,
    glowRadius: 36,
    curatorNotes: "Luminous ultra-violet nebulas, starlight spatter galaxies, and iridescent celestial glow.",
  },
};

const DEFAULT_PLAYER_COLORS = ["#FF3D00", "#06B6D4", "#10B981", "#EC4899"];

interface RoomPlayer {
  id: string;
  socketId: string;
  slot: number; // 1 to 4
  name: string;
  color: string;
  tool: "spray" | "brush";
  mode: "motion" | "projection";
}

interface RoomState {
  roomId: string;
  players: Map<string, RoomPlayer>;
  activeObject: string;
}

const activeRooms = new Map<string, RoomState>();

function getOrCreateRoom(roomId: string): RoomState {
  if (!activeRooms.has(roomId)) {
    activeRooms.set(roomId, {
      roomId,
      players: new Map(),
      activeObject: "easel",
    });
  }
  return activeRooms.get(roomId)!;
}

function assignNextPlayerSlot(room: RoomState, socketId: string, customName?: string): RoomPlayer {
  const usedSlots = new Set(Array.from(room.players.values()).map((p) => p.slot));
  let slot = 1;
  while (slot <= 4 && usedSlots.has(slot)) {
    slot++;
  }
  if (slot > 4) slot = ((room.players.size) % 4) + 1;

  const color = DEFAULT_PLAYER_COLORS[(slot - 1) % DEFAULT_PLAYER_COLORS.length];
  const name = customName || `Tagger ${slot}`;

  const player: RoomPlayer = {
    id: socketId,
    socketId,
    slot,
    name,
    color,
    tool: "spray",
    mode: "motion",
  };

  room.players.set(socketId, player);
  return player;
}

async function generateGraffitiWithFallback(promptText: string, style: string) {
  const ai = getGenAI();
  if (!ai) {
    const preset = CURATED_GRAFFITI_PRESETS[Math.floor(Math.random() * CURATED_GRAFFITI_PRESETS.length)];
    return {
      ...preset,
      title: promptText ? promptText.toUpperCase() : preset.title,
      graffitiText: promptText ? promptText.toUpperCase().slice(0, 10) : preset.graffitiText,
    };
  }

  const modelsToTry = ["gemini-3.7-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: `You are an iconic urban street artist and graffiti master. The user wants inspiration and stencil concepts for their digital spray art session.
User word or theme: "${promptText || "NEON FREEDOM"}"
Style preference: "${style || "wildstyle"}"

Generate a creative street art concept response in JSON format.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "Punchy street art artwork name" },
              tagLine: { type: Type.STRING, description: "Short urban slogan" },
              recommendedPalette: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Array of 4 hex color strings",
              },
              stencilSymbol: { type: Type.STRING, description: "A single unicode iconic stencil symbol" },
              graffitiText: { type: Type.STRING, description: "Stylized lettering word" },
              styleNotes: { type: Type.STRING, description: "1-2 sentence pro spraying tip" },
            },
            required: ["title", "tagLine", "recommendedPalette", "stencilSymbol", "graffitiText", "styleNotes"],
          },
        },
      });

      if (response.text) {
        return JSON.parse(response.text.trim());
      }
    } catch (err: any) {
      console.warn(`Model ${model} attempt failed:`, err?.message || err);
    }
  }

  const preset = CURATED_GRAFFITI_PRESETS[Math.floor(Math.random() * CURATED_GRAFFITI_PRESETS.length)];
  return {
    ...preset,
    title: promptText ? promptText.toUpperCase() : preset.title,
    graffitiText: promptText ? promptText.toUpperCase().slice(0, 10) : preset.graffitiText,
  };
}

async function generateCritiqueWithFallback(objectType: string, dominantColor: string) {
  const ai = getGenAI();
  if (!ai) {
    return {
      exhibitionTitle: "VIBRATIONS IN LOWER EAST SIDE",
      curatorCritique: `A bold, kinetic exploration of aerosol velocity and physical gesture across the 3D ${objectType}.`,
      estimatedValue: "$24,500 USD",
      auctionHouse: "SOTHEBY'S CONTEMPORARY STREET",
      vibeTags: ["#AerosolExpressionism", "#NeoGraffiti", "#RawEnergy"],
    };
  }

  const modelsToTry = ["gemini-3.7-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: `Act as a high-end contemporary art gallery curator and street art historian evaluating a newly completed piece sprayed on a 3D ${objectType} with vibrant ${dominantColor} aerosol paint and brush strokes. Provide an insightful, charismatic critique and auction appraisal.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              exhibitionTitle: { type: Type.STRING, description: "Title of the artwork" },
              curatorCritique: { type: Type.STRING, description: "2-3 sentences of evocative curator appraisal" },
              estimatedValue: { type: Type.STRING, description: "Estimated market value string (e.g. $24,000 USD)" },
              auctionHouse: { type: Type.STRING, description: "Fictional prestige auction house or gallery" },
              vibeTags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "3 hashtag aesthetics",
              },
            },
            required: ["exhibitionTitle", "curatorCritique", "estimatedValue", "auctionHouse", "vibeTags"],
          },
        },
      });

      if (response.text) {
        return JSON.parse(response.text.trim());
      }
    } catch (err: any) {
      console.warn(`Critique model ${model} attempt failed:`, err?.message || err);
    }
  }

  return {
    exhibitionTitle: `CHRONICLES OF ${objectType.toUpperCase()}`,
    curatorCritique: `A magnificent masterclass in raw physical gesture and aerosol texture.`,
    estimatedValue: "$32,000 USD",
    auctionHouse: "CHRISTIE'S POST-WAR & URBAN",
    vibeTags: ["#UrbanMasterpiece", "#Wildstyle3D", "#CollectorGrade"],
  };
}

async function generateStyleTransformation(presetName: string, objectType: string, customPrompt?: string) {
  const fallback = CURATED_TRANSFORMATIONS[presetName] || CURATED_TRANSFORMATIONS.cyberpunk;
  const ai = getGenAI();

  if (!ai) {
    return {
      ...fallback,
      tagText: customPrompt ? customPrompt.toUpperCase().slice(0, 10) : fallback.tagText,
    };
  }

  const modelsToTry = ["gemini-3.7-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: `You are an elite master graffiti artist transforming a physical 3D ${objectType} artwork into the style '${presetName}' (${customPrompt || "enhance aesthetic"}).
Generate artistic transformation parameters and stylized elements in JSON format.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transformedTitle: { type: Type.STRING, description: "Magnificent stylized artwork title" },
              vibe: { type: Type.STRING, description: "Aesthetic genre" },
              tagLine: { type: Type.STRING, description: "Curator headline" },
              accentColor: { type: Type.STRING, description: "Primary glowing hex color" },
              secondaryColor: { type: Type.STRING, description: "Secondary vibrant hex color" },
              stencilSymbol: { type: Type.STRING, description: "Unicode symbol" },
              tagText: { type: Type.STRING, description: "Stylized calligraphic word" },
              dripIntensity: { type: Type.NUMBER, description: "Value between 0.2 and 1.2" },
              glowRadius: { type: Type.NUMBER, description: "Value between 10 and 40" },
              curatorNotes: { type: Type.STRING, description: "1-2 sentences on how the transformation refines the artwork" },
            },
            required: [
              "transformedTitle",
              "vibe",
              "tagLine",
              "accentColor",
              "secondaryColor",
              "stencilSymbol",
              "tagText",
              "dripIntensity",
              "glowRadius",
              "curatorNotes",
            ],
          },
        },
      });

      if (response.text) {
        return JSON.parse(response.text.trim());
      }
    } catch (err: any) {
      console.warn(`Style transform model ${model} attempt failed:`, err?.message || err);
    }
  }

  return {
    ...fallback,
    tagText: customPrompt ? customPrompt.toUpperCase().slice(0, 10) : fallback.tagText,
  };
}


export {
  generateGraffitiWithFallback,
  generateCritiqueWithFallback,
  generateStyleTransformation,
  CURATED_GRAFFITI_PRESETS,
  CURATED_TRANSFORMATIONS,
};

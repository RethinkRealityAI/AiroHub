import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import { GoogleGenAI, Type } from "@google/genai";

let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!genAIClient && process.env.GEMINI_API_KEY) {
    genAIClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
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

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Socket.IO Setup with Multiplayer Relay
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    maxHttpBufferSize: 1e8,
  });

  io.on("connection", (socket) => {
    let currentRoomId: string | null = null;
    let currentRole: string | null = null;

    socket.on("join-room", ({ roomId, role, playerName }) => {
      currentRoomId = roomId;
      currentRole = role;
      socket.join(roomId);

      const room = getOrCreateRoom(roomId);

      if (role === "controller") {
        const player = assignNextPlayerSlot(room, socket.id, playerName);
        socket.emit("player-assigned", player);
        io.to(roomId).emit("player-list-update", Array.from(room.players.values()));
      } else if (role === "canvas") {
        socket.emit("player-list-update", Array.from(room.players.values()));
      }

      socket.to(roomId).emit("user-joined", { id: socket.id, role, playerName });
    });

    // Multiplayer Motion Relay (with Player ID & Slot)
    socket.on("motion", (data) => {
      const room = activeRooms.get(data.roomId);
      const player = room?.players.get(socket.id);
      socket.to(data.roomId).emit("motion", {
        ...data,
        playerId: socket.id,
        playerSlot: player?.slot || 1,
        playerName: player?.name || "Tagger",
        color: player?.color || data.color,
      });
    });

    // Multiplayer Action (Spray / Brush)
    socket.on("action", (data) => {
      const room = activeRooms.get(data.roomId);
      const player = room?.players.get(socket.id);
      if (player && data.color) player.color = data.color;
      if (player && data.action) player.tool = data.action;

      socket.to(data.roomId).emit("action", {
        ...data,
        playerId: socket.id,
        playerSlot: player?.slot || 1,
        playerName: player?.name || "Tagger",
      });
    });

    // Multiplayer Direct Projection Drawing
    socket.on("projection-draw", (data) => {
      const room = activeRooms.get(data.roomId);
      const player = room?.players.get(socket.id);
      socket.to(data.roomId).emit("projection-draw", {
        ...data,
        playerId: socket.id,
        playerSlot: player?.slot || 1,
        playerName: player?.name || "Tagger",
      });
    });

    // Relay 3D Target Object Change
    socket.on("change-object", (data) => {
      const room = activeRooms.get(data.roomId);
      if (room && data.objectType) {
        room.activeObject = data.objectType;
      }
      socket.to(data.roomId).emit("change-object", data);
    });

    // Relay Custom 3D Model Uploaded
    socket.on("custom-3d-uploaded", (data) => {
      socket.to(data.roomId).emit("custom-3d-uploaded", data);
    });

    // Relay calibration
    socket.on("calibrate", (data) => {
      socket.to(data.roomId).emit("calibrate", { ...data, playerId: socket.id });
    });

    // Relay settings
    socket.on("settings", (data) => {
      const room = activeRooms.get(data.roomId);
      const player = room?.players.get(socket.id);
      if (player) {
        if (data.color) player.color = data.color;
        if (data.tool) player.tool = data.tool;
        if (data.playerName) player.name = data.playerName;
        io.to(data.roomId).emit("player-list-update", Array.from(room.players.values()));
      }
      socket.to(data.roomId).emit("settings", { ...data, playerId: socket.id });
    });

    // Relay clear canvas
    socket.on("clear-canvas", (data) => {
      socket.to(data.roomId).emit("clear-canvas", data);
    });

    // Relay spray can shake / ball bearing rattle
    socket.on("shake", (data) => {
      socket.to(data.roomId).emit("shake", { ...data, playerId: socket.id });
    });

    // Relay AI graffiti stamp
    socket.on("ai-stamp", (data) => {
      socket.to(data.roomId).emit("ai-stamp", data);
    });

    // Handle Disconnect
    socket.on("disconnect", () => {
      if (currentRoomId && activeRooms.has(currentRoomId)) {
        const room = activeRooms.get(currentRoomId)!;
        room.players.delete(socket.id);
        io.to(currentRoomId).emit("player-list-update", Array.from(room.players.values()));
        socket.to(currentRoomId).emit("player-left", { id: socket.id });
      }
    });
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // AI Endpoint: Generate Graffiti Tag & Stencil Concepts
  app.post("/api/ai/graffiti-tag", async (req, res) => {
    try {
      const { prompt, style = "wildstyle" } = req.body;
      const result = await generateGraffitiWithFallback(prompt, style);
      res.json(result);
    } catch (err: any) {
      console.error("Gemini graffiti-tag error:", err);
      res.json(CURATED_GRAFFITI_PRESETS[0]);
    }
  });

  // AI Endpoint: Art Critique & Gallery Appraisal
  app.post("/api/ai/critique", async (req, res) => {
    try {
      const { objectType = "easel", dominantColor = "#FF3D00" } = req.body;
      const result = await generateCritiqueWithFallback(objectType, dominantColor);
      res.json(result);
    } catch (err: any) {
      console.error("Gemini critique error:", err);
      res.json({
        exhibitionTitle: "VIBRATIONS IN LOWER EAST SIDE",
        curatorCritique: "A bold, kinetic exploration of aerosol velocity and physical gesture.",
        estimatedValue: "$22,000 USD",
        auctionHouse: "SOTHEBY'S CONTEMPORARY STREET",
        vibeTags: ["#AerosolExpressionism", "#NeoGraffiti", "#RawEnergy"],
      });
    }
  });

  // AI Endpoint: Transform & Stylize Current Painting
  app.post("/api/ai/transform-style", async (req, res) => {
    try {
      const { preset = "cyberpunk", objectType = "easel", customPrompt } = req.body;
      const result = await generateStyleTransformation(preset, objectType, customPrompt);
      res.json(result);
    } catch (err: any) {
      console.error("Gemini transform-style error:", err);
      res.json(CURATED_TRANSFORMATIONS.cyberpunk);
    }
  });

  // Vite Middleware for Dev / Static serving for Prod
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

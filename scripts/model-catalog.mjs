/**
 * AiroHub 3D asset catalog.
 *
 * Every entry is generated with the Meshy text-to-3D API (preview -> refine) and
 * post-processed into a compressed, web-ready GLB in public/models/.
 *
 * `paintPrompt` biases the refine pass towards clean, low-noise base textures so
 * that user spray paint composited on top stays legible.
 */
export const MODEL_CATALOG = [
  // ---- Replacements for the original primitive-built objects ----
  {
    id: 'easel',
    label: 'Studio Easel',
    icon: '🎨',
    category: 'Canvas',
    prompt:
      'A wooden artist studio easel with three legs holding a large blank white stretched rectangular canvas, front facing, clean product render, single object, neutral background',
    texturePrompt:
      'natural oak wood grain frame, pure matte white primed cotton canvas surface, soft even studio lighting, no text, no logos',
    polycount: 18000,
  },
  {
    id: 'skateboard',
    label: 'Skate Deck',
    icon: '🛹',
    category: 'Street',
    prompt:
      'A complete street skateboard with a wide maple deck, concave nose and tail kicks, metal trucks and four wheels, viewed from directly below so the flat blank deck underside faces the camera, single object, studio product photograph',
    texturePrompt:
      'brand new pristine skateboard, completely flat plain white blank deck underside with no artwork, polished silver aluminium trucks, clean white urethane wheels, even softbox studio lighting, no dirt, no grunge, no weathering, no scratches, no stickers, no text',
    polycount: 20000,
  },
  {
    id: 'subway',
    label: 'Subway Car',
    icon: '🚇',
    category: 'Street',
    prompt:
      'A flat rectangular exterior side panel section of a New York City subway train car, with two square windows and a sliding door, straight-on side elevation, single flat panel, studio product photograph',
    texturePrompt:
      'brand new clean brushed stainless steel panel, flat even silver metal surface, dark tinted window glass, even softbox studio lighting, no dirt, no rust, no grunge, no weathering, no graffiti, no text',
    polycount: 24000,
  },
  {
    id: 'boombox',
    label: 'Boombox',
    icon: '📻',
    category: 'Street',
    prompt:
      'A large vintage 1980s portable stereo boombox ghetto blaster with twin round speakers, a cassette deck, a carry handle and a telescopic antenna, front facing, single object',
    texturePrompt:
      'matte charcoal plastic housing, chrome speaker rings, black mesh speaker grilles, silver dials and buttons, no text, no brand logos',
    polycount: 22000,
  },
  {
    id: 'wall',
    label: 'Brick Wall',
    icon: '🧱',
    category: 'Canvas',
    prompt:
      'A flat rectangular section of an urban alley brick wall with a concrete base ledge and a stone cap along the top, front facing, single object',
    texturePrompt:
      'weathered red clay brick with pale grey mortar joints, worn concrete base, clean surface with no graffiti, no text, no posters',
    polycount: 16000,
  },
  {
    id: 'helmet',
    label: 'Moto Helmet',
    icon: '🪖',
    category: 'Objects',
    prompt:
      'A full face motorcycle racing helmet with a smooth glossy aerodynamic shell, chin bar and a clear tinted visor, three quarter front view, single object, studio product photograph',
    texturePrompt:
      'brand new pristine helmet with a completely plain flat matte pure white smooth shell, dark smoked visor, clean black rubber trim, even softbox studio lighting, no dirt, no grunge, no weathering, no scratches, no decals, no text, no logos',
    polycount: 22000,
  },
  {
    id: 'sneaker',
    label: 'High-Top',
    icon: '👟',
    category: 'Objects',
    prompt:
      'A single white high top canvas basketball sneaker standing upright in side profile, with a thick flat rubber sole, padded ankle collar, laces and metal eyelets, single object, studio product photograph',
    texturePrompt:
      'brand new pristine sneaker, completely plain pure white blank canvas upper, clean off white rubber toe cap and sole, white laces, even softbox studio lighting, no dirt, no grunge, no weathering, no gold, no metallic, no logos, no text',
    polycount: 22000,
  },
  {
    id: 'vinyltoy',
    label: 'Vinyl Toy',
    icon: '🧸',
    category: 'Objects',
    prompt:
      'A blank designer vinyl art toy figure with a large round bear head with two round ears, a blocky torso, cylindrical arms and short straight legs, standing upright, front facing, single object, studio product photograph',
    texturePrompt:
      'brand new pristine toy moulded from plain pure white glossy vinyl plastic, completely blank unpainted white surface, no face, no eyes, no markings, bright even softbox studio lighting, not black, no dark colours, no dirt, no grunge, no text',
    polycount: 20000,
  },
  {
    id: 'sculpture',
    label: 'Roman Bust',
    icon: '🗿',
    category: 'Objects',
    prompt:
      'A classical Roman marble portrait bust of a head and shoulders with curly carved hair, mounted on a square plinth pedestal, front facing, single object',
    texturePrompt:
      'plain white carrara marble with soft subtle veining, matte carved stone finish, museum lighting, no text, no gilding',
    polycount: 24000,
  },

  // ---- New objects ----
  {
    id: 'hoodie',
    label: 'Hoodie',
    icon: '🧥',
    category: 'Objects',
    prompt:
      'A blank oversized streetwear pullover hoodie laid flat and facing forward with the hood up, kangaroo pocket, ribbed cuffs and drawstrings, single object',
    texturePrompt:
      'plain heather grey heavyweight cotton fleece with visible fabric weave, white drawstrings, completely blank front, no print, no text, no logos',
    polycount: 20000,
  },
  {
    id: 'guitar',
    label: 'Electric Guitar',
    icon: '🎸',
    category: 'Objects',
    prompt:
      'A solid body electric guitar with a double cutaway, full neck and headstock, six strings, pickups, bridge and control knobs, flat front facing view, single object',
    texturePrompt:
      'plain cream white lacquered solid body ready for custom paint, natural maple neck, chrome hardware, black pickups, no text, no brand logos',
    polycount: 22000,
  },
  {
    id: 'hydrant',
    label: 'Fire Hydrant',
    icon: '🚒',
    category: 'Street',
    prompt:
      'A classic American cast iron street fire hydrant with a domed bonnet cap, two side outlet nozzles and a hexagonal operating nut, standing upright, single object',
    texturePrompt:
      'plain matte cast iron with an even primer grey finish, subtle casting seams and bolt detail, clean surface, no text, no rust streaks',
    polycount: 18000,
  },
  {
    id: 'van',
    label: 'Delivery Van',
    icon: '🚐',
    category: 'Street',
    prompt:
      'A vintage boxy delivery panel van with a large flat blank cargo side panel, round headlights, chrome bumper and steel wheels, side three quarter view, single object',
    texturePrompt:
      'plain flat white painted body panels ready for signwriting, chrome bumpers and trim, dark tinted windows, black rubber tyres, no text, no livery, no logos',
    polycount: 26000,
  },
  {
    id: 'cap',
    label: 'Snapback',
    icon: '🧢',
    category: 'Objects',
    prompt:
      'A blank flat brim snapback baseball cap with a structured six panel crown, button on top, eyelets and a flat visor, three quarter front view, single object',
    texturePrompt:
      'plain black wool blend fabric crown with visible stitched panel seams, flat black brim with a grey underside, completely blank front panel, no embroidery, no text, no logos',
    polycount: 18000,
  },

  // ---- Player tools (spray can + brush) ----
  {
    id: 'tool-spraycan',
    label: 'Spray Can',
    icon: '🥫',
    category: 'Tools',
    isTool: true,
    prompt:
      'A single aerosol spray paint can standing upright, short and wide with a smooth cylindrical body, rolled rims at top and bottom, a narrow shoulder and a round plastic spray cap nozzle on top, studio product photograph',
    texturePrompt:
      'brand new clean can, plain unlabelled polished silver aluminium body with a blank flat white label band around the middle, matte black plastic spray cap, even softbox studio lighting, no dirt, no grunge, no rust, no drips, no text, no barcode, no logos',
    polycount: 14000,
  },
  {
    id: 'tool-brush',
    label: 'Paint Brush',
    icon: '🖌️',
    category: 'Tools',
    isTool: true,
    prompt:
      'A single artist paint brush with a long tapered wooden handle, a crimped metal ferrule and a pointed round bristle tip, lying straight along its length, product render, single object',
    texturePrompt:
      'polished natural birch wood handle, brushed silver crimped metal ferrule, soft dark sable bristles with a clean tip, no text, no markings',
    polycount: 12000,
  },
];

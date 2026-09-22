/**
 * The studio sky.
 *
 * Sits behind the transparent WebGL canvas: a dusk gradient sky with two slowly
 * drifting light masses, dark hills low in the frame and a film grain on top so
 * nothing bands. The colours come from the atmosphere's custom properties on
 * the studio root (`src/ui/studio/atmospheres.ts`); the layers themselves are
 * CSS in `src/index.css`. A solid atmosphere drops the light, the hills and the
 * grain and shows one flat colour. Switching crossfades: the outgoing sky
 * fades under the incoming one rather than snapping.
 */
import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Atmosphere } from './atmospheres';

export const StudioBackdrop: React.FC<{ atmosphere: Atmosphere }> = ({ atmosphere }) => {
  const solid = atmosphere.kind === 'solid';
  const key = solid ? `${atmosphere.id}:${atmosphere.color}` : atmosphere.id;
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
      <AnimatePresence initial={false}>
        <motion.div
          key={key}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: 'easeInOut' }}
        >
          <div className={`studio-aurora ${solid ? 'studio-aurora--solid' : ''}`} />
          {!solid && <div className="studio-hills" />}
          {!solid && <div className="studio-grain" />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

/**
 * The way in to the feedback form, everywhere.
 *
 * One component with two placements so the affordance is learnable: `floating`
 * pins it to the bottom-right corner of the static pages, `inline` drops it
 * into a control cluster that already exists (the studio's right rail, the
 * phone's header) where a fixed corner button would collide with the dock or
 * the safe area. Both are the same glass circle with the same label, so it
 * reads as one button that follows you around rather than four buttons.
 *
 * It is behind `ui.feedbackButton` and renders nothing when that is off — the
 * owner can close the channel from the dashboard on a bad day without a deploy.
 * The sheet is a sibling of the button rather than a route-level singleton
 * because each placement knows its own context: only the studio can say which
 * room the note came from.
 */
import React, { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { GlassIconButton } from '../ui/Glass';
import { useFlags } from '../config/flags';
import { track } from '../analytics/track';
import { FeedbackSheet } from './FeedbackSheet';

export const FeedbackButton: React.FC<{
  variant?: 'floating' | 'inline';
  roomId?: string;
  className?: string;
}> = ({ variant = 'floating', roomId, className = '' }) => {
  const flags = useFlags();
  const [open, setOpen] = useState(false);

  if (!flags.ui.feedbackButton) return null;

  const floating = variant === 'floating';

  return (
    <>
      <GlassIconButton
        // Inline sits in the phone's 32px header cluster; floating owns its
        // corner and gets the standard touch target.
        size={floating ? 44 : 32}
        onClick={() => {
          setOpen(true);
          track('feedback.open', { variant }, roomId);
        }}
        aria-label="Send feedback"
        title="Send feedback"
        className={`${floating ? 'fixed bottom-6 right-6 z-40' : ''} ${className}`}
      >
        <MessageSquare size={floating ? 17 : 13} className="text-[var(--color-airo-aqua)]" />
      </GlassIconButton>

      <FeedbackSheet open={open} onClose={() => setOpen(false)} roomId={roomId} />
    </>
  );
};

export default FeedbackButton;

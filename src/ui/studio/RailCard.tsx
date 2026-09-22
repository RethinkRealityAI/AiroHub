/**
 * A floating rail card: title on the left, a mono badge (or any aside) on the
 * right, content below. Every card on both studio rails is one of these so the
 * rhythm — radius, padding, header height — is identical.
 *
 * Cards collapse to their header from the chevron, and remember it per card
 * (`storageKey`) so a painter who wants the stage to themselves keeps it that
 * way next session. A `grow` card takes the rail's spare height while open and
 * gives it back when collapsed.
 */
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown } from 'lucide-react';

function readCollapsed(key: string | undefined): boolean {
  if (!key) return false;
  try {
    return localStorage.getItem(`airo:rail:${key}`) === 'collapsed';
  } catch {
    return false;
  }
}

export const RailCard: React.FC<
  React.HTMLAttributes<HTMLElement> & {
    title: string;
    badge?: string;
    /** Slot on the header's right, before the collapse chevron. */
    aside?: React.ReactNode;
    /** Remembers the collapsed state under this key. */
    storageKey?: string;
    /** Takes the rail's spare height while open. */
    grow?: boolean;
    /** Pinned under the body, outside its scroll area. */
    footer?: React.ReactNode;
  }
> = ({ title, badge, aside, storageKey, grow, footer, className = '', children, ...rest }) => {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(storageKey));
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (!storageKey) return;
    try {
      localStorage.setItem(`airo:rail:${storageKey}`, next ? 'collapsed' : 'open');
    } catch {
      /* private mode */
    }
  };
  const bodyId = storageKey ? `rail-${storageKey}` : undefined;

  return (
    <section
      className={`rail-card flex flex-col shrink-0 ${grow && !collapsed ? 'flex-1 min-h-0' : ''} ${
        collapsed ? '!py-3' : ''
      } ${className}`}
      {...rest}
    >
      <header className={`flex items-center gap-2 shrink-0 ${collapsed ? '' : 'mb-3.5'}`}>
        <h2 className="text-[15px] font-semibold tracking-tight text-white/95 truncate flex-1 min-w-0">{title}</h2>
        {aside ?? (badge ? <span className="rail-badge">{badge}</span> : null)}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          title={collapsed ? 'Expand' : 'Collapse'}
          className="tap grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
        >
          <motion.span
            animate={{ rotate: collapsed ? -90 : 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="grid place-items-center"
          >
            <ChevronDown size={14} />
          </motion.span>
        </button>
      </header>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            id={bodyId}
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36, mass: 0.8 }}
            className={`flex flex-col overflow-hidden ${grow ? 'flex-1 min-h-0' : ''}`}
          >
            {children}
            {footer && <div className="shrink-0 pt-3">{footer}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

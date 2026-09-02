/**
 * The feedback form.
 *
 * A launch is a conversation, and this is the reply channel: whatever somebody
 * types here lands in the owner's dashboard within seconds, with no account, no
 * email client and no third-party widget in between. That is why the subtitle
 * says where it goes — a form that looks like a support ticket queue gets
 * support tickets, and a form that looks like a note to a person gets notes.
 *
 * Three things it deliberately does not do:
 *
 *  - **It does not ask who you are.** The email field is opt-in and labelled as
 *    such, and the disclosure line states the two things that ride along
 *    without being typed (the current path and the user-agent string) so the
 *    submission holds no surprises.
 *  - **It does not use a captcha.** The `website` input is a honeypot: hidden
 *    from people, irresistible to the sort of bot that fills every field it can
 *    see. The server accepts a filled one with a 200 and writes nothing, so a
 *    bot gets no signal it was caught.
 *  - **It does not lose what you wrote.** A failed send returns to the form
 *    with the text intact and one amber line, in the same register the studio's
 *    AI panel uses when a service is down.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, Bug, Check, Lightbulb, Loader2, MessageSquare, Send } from 'lucide-react';
import { Segmented, Sheet } from '../ui/Glass';
import { track } from '../analytics/track';
import {
  FEEDBACK_MAX,
  FEEDBACK_MIN,
  type FeedbackKind,
  type FeedbackRequest,
} from '../api/contracts';

/** The send button's spray, in the aqua the app uses for "this reaches someone". */
const SEND_PAINT = 'linear-gradient(120deg, #0E7490 0%, #22D3EE 60%, #67E8F9 100%)';

type Phase = 'idle' | 'sending' | 'sent' | 'error';

const KIND_OPTIONS = [
  { value: 'feedback' as const, label: 'Feedback', icon: <MessageSquare size={12} />, accent: '#22D3EE' },
  { value: 'suggestion' as const, label: 'Idea', icon: <Lightbulb size={12} />, accent: '#A78BFA' },
  { value: 'bug' as const, label: 'Bug', icon: <Bug size={12} />, accent: '#FF4D1C' },
];

export const FeedbackSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  roomId?: string;
}> = ({ open, onClose, roomId }) => {
  const [kind, setKind] = useState<FeedbackKind>('feedback');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  /** The honeypot's state. Empty for every human being who has ever lived. */
  const [website, setWebsite] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  // Reopening after a send starts a fresh note rather than showing the last
  // one's receipt; reopening after a failure keeps the text that failed.
  useEffect(() => {
    if (!open || phase !== 'sent') return;
    setPhase('idle');
    setMessage('');
    // Only the open edge matters; `phase` is read, never depended on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed = message.trim();
  // Code points, to agree with the server's floor (an emoji is one, not two).
  const canSend = [...trimmed].length >= FEEDBACK_MIN && phase !== 'sending';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    setPhase('sending');
    setError(null);
    const body: FeedbackRequest = {
      kind,
      message: trimmed,
      email: email.trim(),
      path: location.pathname,
      roomId,
      website,
    };
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`feedback failed (${res.status})`);
      track('feedback.submit', { kind });
      setPhase('sent');
      setEmail('');
    } catch {
      setPhase('error');
      setError('That did not send. Check your connection and try again.');
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      centered
      title="Tell us what you think"
      subtitle="Goes straight to the person who built this."
    >
      {phase === 'sent' ? (
        <div className="py-6 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-400/15 border border-emerald-400/30">
            <Check size={20} className="text-emerald-300" />
          </span>
          <p className="text-[14px] font-bold tracking-tight">Thanks — that landed.</p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-white/50">
            It is already in the dashboard. If you left an email you may hear back.
          </p>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="mb-3.5">
            <Segmented<FeedbackKind>
              layoutId="feedback-kind"
              paint
              value={kind}
              onChange={setKind}
              options={KIND_OPTIONS}
            />
          </div>

          <label className="label-caps mb-1.5 block text-white/35" htmlFor="feedback-message">
            What happened, or what would you change?
          </label>
          <textarea
            id="feedback-message"
            name="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={FEEDBACK_MAX}
            placeholder="Anything at all — a rough edge, a wish, a crash."
            className="min-h-[120px] w-full resize-none rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-[12px] placeholder-white/25 focus:border-[var(--color-airo-aqua)] focus:outline-none"
          />
          <div className="mb-3.5 mt-1 text-right text-[10px] font-mono text-white/30">
            {message.length} / {FEEDBACK_MAX}
          </div>

          <label className="label-caps mb-1.5 block text-white/35" htmlFor="feedback-email">
            Email — only if you want a reply
          </label>
          <input
            id="feedback-email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mb-3.5 w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-[12px] placeholder-white/25 focus:border-[var(--color-airo-aqua)] focus:outline-none"
          />

          {/* Honeypot. Never focusable, never announced, never filled by a person. */}
          <input
            name="website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            className="hidden"
          />

          <button
            type="submit"
            disabled={!canSend}
            className="paint-btn paint-cta tap flex w-full items-center justify-center gap-2 px-6 py-3.5 text-[12.5px] font-bold tracking-wide text-white disabled:opacity-50"
            style={{ '--paint': SEND_PAINT } as React.CSSProperties}
          >
            {phase === 'sending' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send
          </button>

          <p className="mt-2.5 text-center text-[9.5px] leading-relaxed text-white/35">
            Sends the page you're on and your browser version.
          </p>

          {error && (
            <div className="mt-3.5 flex items-start gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-3.5 py-3 text-[11px] text-amber-200/90">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </form>
      )}
    </Sheet>
  );
};

export default FeedbackSheet;

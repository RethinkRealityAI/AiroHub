/**
 * Live media-query match. The studio renders two different furniture sets —
 * floating rails on wide displays, a dock on everything else — and rendering
 * only the active set (rather than hiding one with CSS) keeps a single stamp
 * tray, a single colour well and a single set of keyboard targets on screen.
 */
import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Wide enough for both studio rails plus a comfortable stage between them. */
export const RAILS_QUERY = '(min-width: 1280px)';

'use client';

/*
 * The frame of the capability line with its pause control (WCAG 2.2.2: moving content longer than 5 s can be stopped).
 * The button sets `data-marquee-paused` on the frame and CSS stops the track (`animation-play-state`, site-theme.css):
 * no `motion`, no render per frame. Its name stays the same and `aria-pressed` tells whether the line is stopped.
 * The button shows once the page is interactive: without JavaScript it could not work. With reduce the line is still
 * and wraps, so there is nothing to stop and the button is hidden.
 */
import { IconButton } from '@pharmacy/ui';
import { useState, useSyncExternalStore, type ReactNode } from 'react';

// true in the browser after hydration, false on the server and in the hydration render (markup matches)
const unsubscribe = () => undefined;
const subscribeNothing = () => unsubscribe;
const inBrowser = () => true;
const onServer = () => false;

export interface MarqueeFrameProps {
  /** Accessible name of the pause button («Остановить строку»). */
  pauseLabel: string;
  children: ReactNode;
}

export function MarqueeFrame({ pauseLabel, children }: MarqueeFrameProps) {
  const [paused, setPaused] = useState(false);
  const ready = useSyncExternalStore(subscribeNothing, inBrowser, onServer);
  return (
    <div
      data-marquee-paused={paused ? '' : undefined}
      className="flex items-center"
    >
      {children}
      <div className="shrink-0 pr-4 pl-2 motion-reduce:hidden">
        <IconButton
          icon={paused ? 'play' : 'pause'}
          label={pauseLabel}
          variant="surface"
          aria-pressed={paused}
          onClick={() => setPaused((value) => !value)}
          className={ready ? undefined : 'invisible'}
        />
      </div>
    </div>
  );
}

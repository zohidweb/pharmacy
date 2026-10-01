'use client';

/*
 * Chrome of the app shell: the POS full-screen mode hides the top bar and the sidebar so the
 * receipt and the keypad get the whole 10″ screen (UI mockup «Касса · полный экран»).
 */
import { create } from 'zustand';

interface ShellChrome {
  fullscreen: boolean;
  setFullscreen: (fullscreen: boolean) => void;
}

export const useShellChrome = create<ShellChrome>()((set) => ({
  fullscreen: false,
  setFullscreen: (fullscreen) => set({ fullscreen }),
}));

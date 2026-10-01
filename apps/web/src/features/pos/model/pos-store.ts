'use client';

/*
 * Client state of the POS terminal (ADR-0015, ось 3): the draft receipt in a Zustand store, so the
 * scanner changes it through getState() without re-rendering the whole screen; the draft is
 * mirrored into IndexedDB and survives F5. Server lists never go here.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import type { TerminalRuntime } from '@/shared/lib/offline-queue';
import { emptyDraft, type ReceiptDraft } from './receipt';

export const DRAFT_KEY = 'draft';

interface PosStore {
  draft: ReceiptDraft;
  /** The draft of this store has been read from IndexedDB. */
  hydrated: boolean;
  /** Short message of the last scan/add problem, cleared by the next action. */
  notice: string | null;
  update: (change: (draft: ReceiptDraft) => ReceiptDraft) => void;
  replace: (draft: ReceiptDraft) => void;
  setNotice: (notice: string | null) => void;
}

export const usePosStore = create<PosStore>()((set) => ({
  draft: emptyDraft(),
  hydrated: false,
  notice: null,
  update: (change) =>
    set((state) => ({ draft: change(state.draft), notice: null })),
  replace: (draft) => set({ draft, notice: null }),
  setNotice: (notice) => set({ notice }),
}));

/** Reads the stored draft of the terminal and keeps IndexedDB in step with the store. */
export function useDraftPersistence(runtime: TerminalRuntime | null): void {
  useEffect(() => {
    if (!runtime) return;
    let active = true;
    usePosStore.setState({ hydrated: false });
    runtime.db.get('state', DRAFT_KEY).then((stored) => {
      if (!active) return;
      usePosStore.setState({
        draft: (stored as ReceiptDraft | undefined) ?? emptyDraft(),
        hydrated: true,
      });
    });
    const unsubscribe = usePosStore.subscribe((state, previous) => {
      if (!state.hydrated || state.draft === previous.draft) return;
      void runtime.db.put('state', state.draft, DRAFT_KEY);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [runtime]);
}

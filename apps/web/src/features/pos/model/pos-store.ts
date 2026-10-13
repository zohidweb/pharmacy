'use client';

/*
 * Client state of the POS terminal (ADR-0015, ось 3): the draft receipt in a Zustand store, so the
 * scanner changes it through getState() without re-rendering the whole screen; the draft is
 * mirrored into IndexedDB and survives F5. Server lists never go here.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import {
  isSealed,
  openControlled,
  type PosDb,
  sealControlled,
  type TerminalRuntime,
} from '@/shared/lib/offline-queue';
import { emptyDraft, type ReceiptDraft } from './receipt';

export const DRAFT_KEY = 'draft';

/** Bumped when a paid sale removes the stored draft: older queued draft writes are dropped. */
let draftGeneration = 0;

export function forgetStoredDraft(): void {
  draftGeneration += 1;
}

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

/** The draft for IndexedDB: the prescription data of the ПКУ lines sealed (E17). */
async function sealDraft(db: PosDb, draft: ReceiptDraft): Promise<unknown> {
  return {
    ...draft,
    lines: await Promise.all(
      draft.lines.map(async (line) => ({
        ...line,
        controlled:
          line.controlled === null
            ? null
            : await sealControlled(db, line.controlled),
      })),
    ),
  };
}

/** The stored draft opened; a draft that cannot be opened (another key) loses its prescription data. */
async function openDraft(db: PosDb, stored: unknown): Promise<ReceiptDraft> {
  if (!stored) return emptyDraft();
  const draft = stored as ReceiptDraft;
  return {
    ...draft,
    lines: await Promise.all(
      draft.lines.map(async (line) => ({
        ...line,
        controlled: isSealed(line.controlled)
          ? await openControlled(db, line.controlled).catch(() => null)
          : line.controlled,
      })),
    ),
  };
}

/** Reads the stored draft of the terminal and keeps IndexedDB in step with the store. */
export function useDraftPersistence(runtime: TerminalRuntime | null): void {
  useEffect(() => {
    if (!runtime) return;
    let active = true;
    usePosStore.setState({ hydrated: false });
    runtime.db
      .get('state', DRAFT_KEY)
      .then((stored) => openDraft(runtime.db, stored))
      .then((draft) => {
        if (!active) return;
        usePosStore.setState({ draft, hydrated: true });
      });
    // sealing is asynchronous: the writes go one after another, the last draft wins
    let writes = Promise.resolve();
    const unsubscribe = usePosStore.subscribe((state, previous) => {
      if (!state.hydrated || state.draft === previous.draft) return;
      const draft = state.draft;
      const generation = draftGeneration;
      writes = writes
        .then(() => sealDraft(runtime.db, draft))
        .then(async (sealed) => {
          // the cart was paid meanwhile: this draft is not the current one any more
          if (generation !== draftGeneration) return;
          await runtime.db.put('state', sealed, DRAFT_KEY);
        })
        .then(
          () => undefined,
          () => undefined,
        );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [runtime]);
}

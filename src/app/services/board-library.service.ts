import { Injectable, computed, signal } from '@angular/core';
import { AboardDocument } from '../models/aboard.models';
import { SAMPLE_DOCUMENT } from '../data/sample-document';

export interface StoredBoard {
  id: string;
  title: string;
  document: AboardDocument;
  updatedAt: number;
  nodeCount: number;
}

const LIBRARY_KEY = 'aboard.boards.v1';
const ACTIVE_KEY = 'aboard.activeBoardId';

@Injectable({ providedIn: 'root' })
export class BoardLibraryService {
  private readonly boards = signal<StoredBoard[]>([]);
  private readonly activeId = signal<string | null>(null);

  readonly library = this.boards.asReadonly();
  readonly activeBoardId = this.activeId.asReadonly();
  readonly inExplorer = computed(() => this.activeId() !== null);

  readonly activeBoard = computed(() => {
    const id = this.activeId();
    return id ? this.boards().find((b) => b.id === id) ?? null : null;
  });

  constructor() {
    const hasStoredLibrary = this.loadFromStorage();
    if (!hasStoredLibrary && this.boards().length === 0) {
      this.upsertDocument(structuredClone(SAMPLE_DOCUMENT));
    }
  }

  /** Persist a document in the library and return its id. */
  upsertDocument(doc: AboardDocument, existingId?: string | null): string {
    const id = existingId ?? this.makeId();
    const entry: StoredBoard = {
      id,
      title: doc.title || 'Untitled board',
      document: structuredClone(doc),
      updatedAt: Date.now(),
      nodeCount: doc.nodes.length,
    };

    const list = [...this.boards()];
    const idx = list.findIndex((b) => b.id === id);
    if (idx >= 0) list[idx] = entry;
    else list.unshift(entry);

    this.boards.set(list);
    this.persist();
    return id;
  }

  openBoard(id: string): StoredBoard | null {
    const board = this.boards().find((b) => b.id === id);
    if (!board) return null;
    this.activeId.set(id);
    localStorage.setItem(ACTIVE_KEY, id);
    return board;
  }

  closeExplorer(): void {
    this.activeId.set(null);
    localStorage.removeItem(ACTIVE_KEY);
  }

  deleteBoard(id: string): void {
    this.boards.update((list) => list.filter((b) => b.id !== id));
    if (this.activeId() === id) {
      this.closeExplorer();
    }
    this.persist();
  }

  deleteBoards(ids: Iterable<string>): void {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;

    this.boards.update((list) => list.filter((b) => !idSet.has(b.id)));
    const activeId = this.activeId();
    if (activeId && idSet.has(activeId)) {
      this.closeExplorer();
    }
    this.persist();
  }

  /** Replace the active board's stored document (e.g. after import while open). */
  refreshActive(doc: AboardDocument): void {
    const id = this.activeId();
    if (!id) return;
    this.upsertDocument(doc, id);
  }

  restoreLastSession(): string | null {
    const id = localStorage.getItem(ACTIVE_KEY);
    if (id && this.boards().some((b) => b.id === id)) {
      this.activeId.set(id);
      return id;
    }
    return null;
  }

  private loadFromStorage(): boolean {
    try {
      const raw = localStorage.getItem(LIBRARY_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as StoredBoard[];
      if (Array.isArray(parsed)) {
        this.boards.set(parsed.filter((b) => b?.id && b?.document?.nodes));
        return true;
      }
    } catch {
      // Corrupt storage — start fresh on next upsert.
    }
    return false;
  }

  private persist(): void {
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(this.boards()));
    } catch {
      // Quota exceeded — library stays in memory for this session.
    }
  }

  private makeId(): string {
    return `board-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

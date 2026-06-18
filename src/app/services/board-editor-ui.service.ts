import { Injectable, computed, signal } from '@angular/core';

export type EditorTab = 'board' | 'schema' | 'nodes' | 'relationships';

@Injectable({ providedIn: 'root' })
export class BoardEditorUiService {
  readonly isOpen = signal(false);
  readonly initialTab = signal<EditorTab>('board');
  readonly activeTab = signal<EditorTab>('board');
  /** Selected item id when curating on the Items tab (null = new item form). */
  readonly editingNodeId = signal<string | null>(null);
  /** Bumped to reset the new-item form from outside the editor panel. */
  readonly newItemNonce = signal(0);

  readonly curatingItems = computed(() => this.isOpen() && this.activeTab() === 'nodes');

  open(tab: EditorTab = 'board'): void {
    this.initialTab.set(tab);
    this.activeTab.set(tab);
    this.editingNodeId.set(null);
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
    this.editingNodeId.set(null);
  }

  setTab(tab: EditorTab): void {
    this.activeTab.set(tab);
    if (tab !== 'nodes') {
      this.editingNodeId.set(null);
    }
  }

  selectNodeForEdit(nodeId: string): void {
    this.editingNodeId.set(nodeId);
  }

  requestNewItem(): void {
    this.editingNodeId.set(null);
    this.newItemNonce.update((n) => n + 1);
  }
}

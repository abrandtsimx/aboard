import { Injectable, signal } from '@angular/core';

export type EditorTab = 'board' | 'schema' | 'nodes' | 'relationships';

@Injectable({ providedIn: 'root' })
export class BoardEditorUiService {
  readonly isOpen = signal(false);
  readonly initialTab = signal<EditorTab>('board');

  open(tab: EditorTab = 'board'): void {
    this.initialTab.set(tab);
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }
}

import { Component, computed, inject, NgZone, signal } from '@angular/core';
import { BoardLibraryService, StoredBoard } from '../../services/board-library.service';
import { DocumentService } from '../../services/document.service';
import { BoardCurationService } from '../../services/board-curation.service';
import { BoardEditorUiService } from '../../services/board-editor-ui.service';
import { EXAMPLE_BOARDS } from '../../data/example-boards';
import { publicAssetUrl } from '../../utils/public-asset.util';

@Component({
  selector: 'app-dashboard',
  imports: [],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  protected readonly library = inject(BoardLibraryService);
  protected readonly examples = EXAMPLE_BOARDS;
  protected readonly selectedBoardIds = signal<Set<string>>(new Set());
  protected readonly selectedCount = computed(() => this.selectedBoardIds().size);
  protected readonly allBoardsSelected = computed(() => {
    const boards = this.library.library();
    const selected = this.selectedBoardIds();
    return boards.length > 0 && boards.every((board) => selected.has(board.id));
  });
  private readonly doc = inject(DocumentService);
  private readonly curation = inject(BoardCurationService);
  private readonly editorUi = inject(BoardEditorUiService);
  private readonly zone = inject(NgZone);

  protected openBoard(board: StoredBoard): void {
    this.library.openBoard(board.id);
    this.doc.loadDocument(structuredClone(board.document));
  }

  protected createBlankBoard(): void {
    const doc = this.curation.createBlankBoard();
    this.curation.loadBoard(doc);
    const id = this.library.upsertDocument(doc);
    this.library.openBoard(id);
    this.editorUi.open('nodes');
  }

  protected deleteBoard(event: MouseEvent, id: string): void {
    event.stopPropagation();
    if (!confirm('Remove this board from your library?')) return;
    this.library.deleteBoard(id);
    this.selectedBoardIds.update((selected) => {
      const next = new Set(selected);
      next.delete(id);
      return next;
    });
  }

  protected toggleBoardSelection(event: Event, id: string): void {
    event.stopPropagation();
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedBoardIds.update((selected) => {
      const next = new Set(selected);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  }

  protected toggleAllBoards(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedBoardIds.set(
      checked ? new Set(this.library.library().map((board) => board.id)) : new Set()
    );
  }

  protected deleteSelectedBoards(): void {
    const ids = this.selectedBoardIds();
    if (ids.size === 0) return;

    const label = ids.size === 1 ? 'this board' : `${ids.size} boards`;
    if (!confirm(`Remove ${label} from your library?`)) return;
    this.library.deleteBoards(ids);
    this.selectedBoardIds.set(new Set());
  }

  protected onImport(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () =>
      this.zone.run(() => {
        try {
          const raw = (reader.result as string).replace(/^\uFEFF/, '');
          this.doc.importFromJson(raw);
          const id = this.library.upsertDocument(this.doc.currentDocument());
          this.library.openBoard(id);
        } catch (e) {
          alert(`Import failed: ${(e as Error).message}`);
        }
        input.value = '';
      });
    reader.onerror = () => {
      alert('Could not read the selected file.');
      input.value = '';
    };
    reader.readAsText(file);
  }

  protected loadExample(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const path = select.value;
    if (!path) return;
    select.value = '';

    fetch(publicAssetUrl(path))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((json) => {
        this.zone.run(() => {
          this.doc.importFromJson(json.replace(/^\uFEFF/, ''));
          const id = this.library.upsertDocument(this.doc.currentDocument());
          this.library.openBoard(id);
        });
      })
      .catch((e) => alert(`Failed to load example: ${(e as Error).message}`));
  }

  protected formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}

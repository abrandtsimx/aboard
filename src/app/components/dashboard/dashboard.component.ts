import { Component, inject, NgZone } from '@angular/core';
import { BoardLibraryService, StoredBoard } from '../../services/board-library.service';
import { DocumentService } from '../../services/document.service';

@Component({
  selector: 'app-dashboard',
  imports: [],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  protected readonly library = inject(BoardLibraryService);
  private readonly doc = inject(DocumentService);
  private readonly zone = inject(NgZone);

  protected openBoard(board: StoredBoard): void {
    this.library.openBoard(board.id);
    this.doc.loadDocument(structuredClone(board.document));
  }

  protected deleteBoard(event: MouseEvent, id: string): void {
    event.stopPropagation();
    if (!confirm('Remove this board from your library?')) return;
    this.library.deleteBoard(id);
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

    fetch(path)
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

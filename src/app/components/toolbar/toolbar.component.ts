import { Component, inject, NgZone } from '@angular/core';
import { DocumentService } from '../../services/document.service';
import { BoardLibraryService } from '../../services/board-library.service';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss',
})
export class ToolbarComponent {
  protected readonly doc = inject(DocumentService);
  protected readonly library = inject(BoardLibraryService);
  private readonly zone = inject(NgZone);

  protected goToDashboard(): void {
    this.library.refreshActive(this.doc.currentDocument());
    this.library.closeExplorer();
  }

  onImport(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
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
    };
    reader.onerror = () => {
      alert('Could not read the selected file.');
      input.value = '';
    };
    reader.readAsText(file);
  }

  loadExample(event: Event): void {
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

  onExport(): void {
    const json = this.doc.exportDocument();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.slugify(this.doc.currentDocument().title)}.board`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
}

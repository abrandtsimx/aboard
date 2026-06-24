import { Component, inject, NgZone, signal } from '@angular/core';
import { DocumentService } from '../../services/document.service';
import { BoardLibraryService } from '../../services/board-library.service';
import { BoardEditorUiService } from '../../services/board-editor-ui.service';
import { AppModeService } from '../../services/app-mode.service';
import { EXAMPLE_BOARDS } from '../../data/example-boards';
import { publicAssetUrl } from '../../utils/public-asset.util';
import { buildShareUrl, downloadShareHtml, isShareUrlTooLarge } from '../../utils/share-link.util';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss',
})
export class ToolbarComponent {
  protected readonly doc = inject(DocumentService);
  protected readonly library = inject(BoardLibraryService);
  protected readonly editorUi = inject(BoardEditorUiService);
  protected readonly appMode = inject(AppModeService);
  protected readonly examples = EXAMPLE_BOARDS;
  private readonly zone = inject(NgZone);

  protected readonly shareCopied = signal<'link' | 'file' | false>(false);
  private shareCopiedTimer: ReturnType<typeof setTimeout> | null = null;

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

  protected async onShare(): Promise<void> {
    const doc = this.doc.currentDocument();
    const json = JSON.stringify(doc);
    const url = await buildShareUrl(json);

    if (!isShareUrlTooLarge(url)) {
      try {
        await navigator.clipboard.writeText(url);
        this.flashShareCopied('link');
      } catch {
        window.prompt('Copy this view-only link:', url);
      }
      return;
    }

    downloadShareHtml(doc.title, json);
    this.flashShareCopied('file');
  }

  private flashShareCopied(kind: 'link' | 'file'): void {
    this.shareCopied.set(kind);
    if (this.shareCopiedTimer) clearTimeout(this.shareCopiedTimer);
    this.shareCopiedTimer = setTimeout(() => this.shareCopied.set(false), 3000);
  }

  private slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
}

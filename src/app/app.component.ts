import { Component, HostListener, inject, NgZone, OnInit, signal } from '@angular/core';
import { ToolbarComponent } from './components/toolbar/toolbar.component';
import { WorkspaceComponent } from './components/workspace/workspace.component';
import { SearchPanelComponent } from './components/search-panel/search-panel.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { BoardEditorComponent } from './components/board-editor/board-editor.component';
import { DocumentService } from './services/document.service';
import { BoardLibraryService } from './services/board-library.service';

@Component({
  selector: 'app-root',
  imports: [
    ToolbarComponent,
    WorkspaceComponent,
    SearchPanelComponent,
    DashboardComponent,
    BoardEditorComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  private readonly doc = inject(DocumentService);
  protected readonly library = inject(BoardLibraryService);
  private readonly zone = inject(NgZone);

  protected readonly isDragging = signal(false);
  protected readonly dropError = signal<string | null>(null);

  private dragDepth = 0;

  ngOnInit(): void {
    const lastId = this.library.restoreLastSession();
    if (lastId) {
      const board = this.library.openBoard(lastId);
      if (board) this.doc.loadDocument(structuredClone(board.document));
    }
  }

  @HostListener('document:dragenter', ['$event'])
  protected onDragEnter(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    event.preventDefault();
    this.dragDepth++;
    this.isDragging.set(true);
  }

  @HostListener('document:dragover', ['$event'])
  protected onDragOver(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  @HostListener('document:dragleave', ['$event'])
  protected onDragLeave(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.isDragging.set(false);
  }

  @HostListener('document:drop', ['$event'])
  protected onDrop(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.isDragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.loadFile(file);
  }

  protected clearError(): void {
    this.dropError.set(null);
  }

  private isFileDrag(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  }

  private loadFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () =>
      this.zone.run(() => {
        try {
          const raw = (reader.result as string).replace(/^\uFEFF/, '');
          this.doc.importFromJson(raw);
          const id = this.library.upsertDocument(this.doc.currentDocument());
          this.library.openBoard(id);
          this.dropError.set(null);
        } catch (e) {
          this.dropError.set(`Couldn't load "${file.name}": ${(e as Error).message}`);
        }
      });
    reader.onerror = () =>
      this.zone.run(() => this.dropError.set(`Could not read "${file.name}".`));
    reader.readAsText(file);
  }
}

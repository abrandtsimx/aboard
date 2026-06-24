import { Component, HostListener, inject, NgZone, OnInit, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ToolbarComponent } from './components/toolbar/toolbar.component';
import { WorkspaceComponent } from './components/workspace/workspace.component';
import { SearchPanelComponent } from './components/search-panel/search-panel.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { BoardEditorComponent } from './components/board-editor/board-editor.component';
import { DocumentService } from './services/document.service';
import { BoardLibraryService } from './services/board-library.service';
import { BoardEditorUiService } from './services/board-editor-ui.service';
import { AppModeService } from './services/app-mode.service';
import { buildShareViewerUrl, extractBoardJsonFromShareHtml, readSharePayloadFromHash } from './utils/share-link.util';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
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
  protected readonly editorUi = inject(BoardEditorUiService);
  protected readonly appMode = inject(AppModeService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);

  protected readonly isDragging = signal(false);
  protected readonly dropError = signal<string | null>(null);
  protected readonly shareError = signal<string | null>(null);
  protected readonly shareLanding = signal(false);
  protected readonly shareLoading = signal(false);
  protected readonly shareBoardLoaded = signal(false);
  protected readonly shareViewerUrl = buildShareViewerUrl();

  private dragDepth = 0;
  private shareEmbedMode = false;

  ngOnInit(): void {
    void this.bootstrapFromRoute(this.router.url);
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => void this.bootstrapFromRoute((event as NavigationEnd).urlAfterRedirects));
  }

  protected get inExplorer(): boolean {
    return this.library.inExplorer() || (this.appMode.isShareView() && this.shareBoardLoaded());
  }

  protected get shareAwaitingBoard(): boolean {
    return this.appMode.isShareView() && !this.shareBoardLoaded();
  }

  private async bootstrapFromRoute(url: string): Promise<void> {
    const routePath = url.split('?')[0]?.split('#')[0] ?? url;
    const locationPath = window.location.pathname;
    if (this.isShareRoute(routePath) || this.isShareRoute(locationPath)) {
      await this.bootstrapShareView();
      return;
    }

    if (this.appMode.isShareView()) {
      this.resetShareState();
      this.appMode.exitShareView();
    }

    if (this.library.inExplorer()) return;

    const lastId = this.library.restoreLastSession();
    if (lastId) {
      const board = this.library.openBoard(lastId);
      if (board) this.doc.loadDocument(structuredClone(board.document));
    }
  }

  private isShareRoute(url: string): boolean {
    const path = url.split('?')[0]?.split('#')[0] ?? url;
    return /\/share\/?$/.test(path);
  }

  private async bootstrapShareView(): Promise<void> {
    this.appMode.enterShareView();
    this.editorUi.close();
    this.library.closeExplorer();
    this.resetShareState();

    const params = new URLSearchParams(window.location.search);
    this.shareEmbedMode = params.get('embed') === '1';

    const hash = window.location.hash;
    if (hash.length > 1) {
      this.shareLoading.set(true);
      try {
        const json = await readSharePayloadFromHash(hash);
        if (json) {
          this.loadSharedBoard(json);
          return;
        }
      } catch (e) {
        this.shareError.set(`Couldn't open this share link: ${(e as Error).message}`);
        return;
      } finally {
        this.shareLoading.set(false);
      }
    }

    const src = params.get('src');
    if (src) {
      await this.loadShareFromUrl(src);
      return;
    }

    if (this.shareEmbedMode) {
      this.shareLoading.set(true);
      return;
    }

    this.shareLanding.set(true);
  }

  private resetShareState(): void {
    this.shareError.set(null);
    this.shareLanding.set(false);
    this.shareLoading.set(false);
    this.shareBoardLoaded.set(false);
    this.shareEmbedMode = false;
  }

  private loadSharedBoard(json: string): void {
    this.doc.importFromJson(json);
    this.shareBoardLoaded.set(true);
    this.shareLanding.set(false);
    this.shareLoading.set(false);
    this.shareError.set(null);
  }

  private async loadShareFromUrl(src: string): Promise<void> {
    this.shareLoading.set(true);
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.text()).replace(/^\uFEFF/, '');
      this.loadSharedBoard(json);
    } catch (e) {
      this.shareError.set(
        `Couldn't load the board from that URL. If the file is hosted elsewhere, try downloading the .board file and opening it here instead. (${(e as Error).message})`
      );
    } finally {
      this.shareLoading.set(false);
    }
  }

  @HostListener('window:message', ['$event'])
  protected onShareMessage(event: MessageEvent): void {
    if (!this.appMode.isShareView() || !this.shareEmbedMode) return;
    if (event.data?.type !== 'aboard-share' || typeof event.data.json !== 'string') return;

    try {
      this.loadSharedBoard(event.data.json);
    } catch (e) {
      this.shareError.set(`Couldn't open shared board: ${(e as Error).message}`);
      this.shareLoading.set(false);
    }
  }

  protected onShareFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.loadShareFile(file);
    input.value = '';
  }

  @HostListener('document:dragenter', ['$event'])
  protected onDragEnter(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    if (this.appMode.isShareView() && this.shareBoardLoaded()) return;
    event.preventDefault();
    this.dragDepth++;
    this.isDragging.set(true);
  }

  @HostListener('document:dragover', ['$event'])
  protected onDragOver(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    if (this.appMode.isShareView() && this.shareBoardLoaded()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  @HostListener('document:dragleave', ['$event'])
  protected onDragLeave(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    if (this.appMode.isShareView() && this.shareBoardLoaded()) return;
    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.isDragging.set(false);
  }

  @HostListener('document:drop', ['$event'])
  protected onDrop(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    if (this.appMode.isShareView() && this.shareBoardLoaded()) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.isDragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      if (this.appMode.isShareView()) this.loadShareFile(file);
      else this.loadLibraryFile(file);
    }
  }

  protected clearError(): void {
    this.dropError.set(null);
  }

  private isFileDrag(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  }

  private loadLibraryFile(file: File): void {
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

  private loadShareFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () =>
      this.zone.run(() => {
        try {
          const raw = (reader.result as string).replace(/^\uFEFF/, '');
          const json = file.name.toLowerCase().endsWith('.html')
            ? extractBoardJsonFromShareHtml(raw)
            : raw;
          this.loadSharedBoard(json);
        } catch (e) {
          this.shareError.set(`Couldn't open "${file.name}": ${(e as Error).message}`);
        }
      });
    reader.onerror = () =>
      this.zone.run(() => this.shareError.set(`Could not read "${file.name}".`));
    reader.readAsText(file);
  }
}

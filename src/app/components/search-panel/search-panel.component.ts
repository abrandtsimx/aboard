import { Component, computed, inject, signal } from '@angular/core';
import { DocumentService } from '../../services/document.service';
import { BoardEditorUiService } from '../../services/board-editor-ui.service';
import { AboardNode } from '../../models/aboard.models';
import {
  buildSidebarGroups,
  sidebarMarkerColor,
  SidebarGroup,
} from '../../utils/sidebar-groups.util';

@Component({
  selector: 'app-search-panel',
  standalone: true,
  templateUrl: './search-panel.component.html',
  styleUrl: './search-panel.component.scss',
})
export class SearchPanelComponent {
  protected readonly doc = inject(DocumentService);
  protected readonly editorUi = inject(BoardEditorUiService);

  protected readonly query = signal('');
  private readonly collapsed = signal<ReadonlySet<string>>(new Set());

  protected readonly boardTitle = computed(() => this.doc.currentDocument().title);

  protected readonly groups = computed<SidebarGroup[]>(() => {
    const q = this.query().trim().toLowerCase();
    const doc = this.doc.currentDocument();
    const nodes = doc.nodes;
    const matches = q
      ? nodes.filter(
          (n) =>
            n.id !== doc.rootId &&
            (n.label.toLowerCase().includes(q) ||
              (n.description ?? '').toLowerCase().includes(q))
        )
      : nodes;

    return buildSidebarGroups(doc, matches);
  });

  protected readonly totalCount = computed(() =>
    this.groups().reduce((sum, g) => sum + g.nodes.length, 0)
  );

  protected isCollapsed(typeKey: string): boolean {
    if (this.query().trim()) return false;
    return this.collapsed().has(typeKey);
  }

  protected toggle(typeKey: string): void {
    const next = new Set(this.collapsed());
    if (next.has(typeKey)) next.delete(typeKey);
    else next.add(typeKey);
    this.collapsed.set(next);
  }

  protected goHome(): void {
    if (this.editorUi.isOpen()) {
      this.editorUi.setTab('board');
      return;
    }
    this.doc.navigateTo(this.doc.currentDocument().rootId);
  }

  protected isRootActive(): boolean {
    if (this.editorUi.isOpen()) {
      return this.editorUi.activeTab() === 'board';
    }
    return (
      this.doc.atMapRoot() && !this.doc.peekId() && this.doc.mode() === 'canvas'
    );
  }

  protected select(node: AboardNode): void {
    if (this.editorUi.curatingItems()) {
      this.editorUi.selectNodeForEdit(node.id);
      return;
    }
    this.doc.navigateTo(node.id);
  }

  protected isActive(node: AboardNode): boolean {
    if (this.editorUi.curatingItems()) {
      return this.editorUi.editingNodeId() === node.id;
    }
    if (this.doc.mode() === 'immersed') {
      return this.doc.immersedNode()?.id === node.id;
    }
    return this.doc.peekId() === node.id;
  }

  protected isCuratingNewItem(): boolean {
    return this.editorUi.curatingItems() && this.editorUi.editingNodeId() === null;
  }

  protected markerColor(node: AboardNode): string | null {
    return sidebarMarkerColor(node, this.doc.currentDocument());
  }

  protected markerClass(typeKey: string): string {
    return `item__marker--${typeKey.replace(/[^a-z0-9-]/gi, '-')}`;
  }

  protected onQuery(value: string): void {
    this.query.set(value);
  }

  protected clearQuery(): void {
    this.query.set('');
  }
}

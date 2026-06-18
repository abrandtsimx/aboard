import { Component, computed, inject, signal } from '@angular/core';
import { DocumentService } from '../../services/document.service';
import { BoardEditorUiService } from '../../services/board-editor-ui.service';
import { AboardNode, NodeCategory } from '../../models/aboard.models';
import { getNodeCategory, categoryLabel } from '../../utils/category.util';

interface SearchGroup {
  category: NodeCategory;
  label: string;
  nodes: AboardNode[];
}

const CATEGORY_ORDER: NodeCategory[] = [
  'environment',
  'application',
  'data-type',
  'infrastructure',
  'external-tool',
  'process',
];

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
  private readonly collapsed = signal<ReadonlySet<NodeCategory>>(new Set());

  protected readonly groups = computed<SearchGroup[]>(() => {
    const q = this.query().trim().toLowerCase();
    const nodes = this.doc.currentDocument().nodes;
    const matches = q
      ? nodes.filter(
          (n) =>
            n.label.toLowerCase().includes(q) ||
            (n.description ?? '').toLowerCase().includes(q)
        )
      : nodes;

    const byCategory = new Map<NodeCategory, AboardNode[]>();
    for (const node of matches) {
      const cat = getNodeCategory(node);
      const list = byCategory.get(cat) ?? [];
      list.push(node);
      byCategory.set(cat, list);
    }

    const result: SearchGroup[] = [];
    for (const cat of CATEGORY_ORDER) {
      const list = byCategory.get(cat);
      if (!list?.length) continue;
      list.sort((a, b) => a.label.localeCompare(b.label));
      result.push({ category: cat, label: categoryLabel(cat), nodes: list });
    }
    return result;
  });

  protected readonly totalCount = computed(() =>
    this.groups().reduce((sum, g) => sum + g.nodes.length, 0)
  );

  protected isCollapsed(category: NodeCategory): boolean {
    // While searching, keep every group open so results are always visible.
    if (this.query().trim()) return false;
    return this.collapsed().has(category);
  }

  protected toggle(category: NodeCategory): void {
    const next = new Set(this.collapsed());
    if (next.has(category)) next.delete(category);
    else next.add(category);
    this.collapsed.set(next);
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

  protected onQuery(value: string): void {
    this.query.set(value);
  }

  protected clearQuery(): void {
    this.query.set('');
  }
}

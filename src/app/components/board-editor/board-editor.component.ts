import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DocumentService } from '../../services/document.service';
import {
  BoardCurationService,
  BoardTagDraft,
  getNodeTypeOptions,
  NODE_CATEGORY_OPTIONS,
  NodeDraft,
  RelationshipDraft,
  SchemaTypeDraft,
  SHAPE_OPTIONS,
} from '../../services/board-curation.service';
import { BoardEditorUiService, EditorTab } from '../../services/board-editor-ui.service';
import { AboardNode, AboardRelationship, BoardTag, SchemaType } from '../../models/aboard.models';
import { tagLabel } from '../../utils/tag.util';

@Component({
  selector: 'app-board-editor',
  imports: [FormsModule],
  templateUrl: './board-editor.component.html',
  styleUrl: './board-editor.component.scss',
})
export class BoardEditorComponent {
  protected readonly doc = inject(DocumentService);
  protected readonly curation = inject(BoardCurationService);
  private readonly ui = inject(BoardEditorUiService);

  protected readonly isOpen = this.ui.isOpen;
  protected readonly activeTab = this.ui.activeTab;
  protected readonly editingNodeId = this.ui.editingNodeId;
  protected readonly error = signal<string | null>(null);

  protected readonly boardTitle = signal('');
  protected readonly editingRelId = signal<string | null>(null);
  protected readonly editingSchemaId = signal<string | null>(null);
  protected readonly editingTagId = signal<string | null>(null);

  protected readonly nodeDraft = signal<NodeDraft>(this.curation.emptyNodeDraft());
  protected readonly relDraft = signal<RelationshipDraft>(this.curation.emptyRelationshipDraft());
  protected readonly schemaDraft = signal<SchemaTypeDraft>(this.curation.emptySchemaTypeDraft());
  protected readonly tagDraft = signal<BoardTagDraft>(this.curation.emptyBoardTagDraft());

  protected readonly nodeTypeOptions = computed(() =>
    getNodeTypeOptions(this.doc.currentDocument(), this.nodeDraft().type)
  );
  protected readonly usesSchemaTypes = computed(() => this.schemaTypes().length > 0);
  protected readonly categoryOptions = NODE_CATEGORY_OPTIONS;
  protected readonly shapeOptions = SHAPE_OPTIONS;

  protected readonly nodes = computed(() => this.doc.currentDocument().nodes);
  protected readonly relationships = computed(() => this.doc.currentDocument().relationships);
  protected readonly schemaTypes = computed(() => this.doc.currentDocument().schema?.types ?? []);
  protected readonly boardTags = computed(() => this.doc.currentDocument().tags ?? []);

  protected readonly parentOptions = computed(() => {
    const editingId = this.editingNodeId();
    return this.nodes().filter((n) => n.id !== editingId);
  });

  protected readonly showTagPicker = computed(() => {
    const category = this.nodeDraft().category;
    return category === 'application' || category === 'data-type';
  });

  private editorWasOpen = false;

  constructor() {
    effect(() => {
      const open = this.ui.isOpen();
      if (open && !this.editorWasOpen) {
        this.syncOnOpen();
      }
      this.editorWasOpen = open;
    });

    effect(() => {
      const id = this.ui.editingNodeId();
      if (!this.ui.isOpen() || this.ui.activeTab() !== 'nodes') return;
      if (id) {
        const node = this.doc.findNode(id);
        if (node) {
          this.nodeDraft.set(this.curation.nodeToDraft(node));
          this.error.set(null);
        }
      }
    });

    effect(() => {
      this.ui.newItemNonce();
      if (!this.ui.isOpen() || this.ui.activeTab() !== 'nodes') return;
      if (this.ui.editingNodeId() !== null) return;
      this.nodeDraft.set(this.curation.emptyNodeDraft());
      this.error.set(null);
    });
  }

  private syncOnOpen(): void {
    this.boardTitle.set(this.doc.currentDocument().title);
    this.ui.activeTab.set(this.ui.initialTab());
    this.ui.editingNodeId.set(null);
    this.error.set(null);
    this.resetNodeForm();
    this.resetRelForm();
    this.resetSchemaForm();
    this.resetTagForm();
  }

  open(tab: EditorTab = 'board'): void {
    this.ui.open(tab);
  }

  close(): void {
    this.ui.close();
    this.error.set(null);
  }

  setTab(tab: EditorTab): void {
    this.ui.setTab(tab);
    this.error.set(null);
  }

  saveBoardTitle(): void {
    this.run(() => this.curation.setTitle(this.boardTitle()));
  }

  startNewTag(): void {
    this.editingTagId.set(null);
    this.tagDraft.set(this.curation.emptyBoardTagDraft());
    this.error.set(null);
  }

  editTag(tag: BoardTag): void {
    this.editingTagId.set(tag.id);
    this.tagDraft.set(this.curation.boardTagToDraft(tag));
    this.error.set(null);
  }

  onTagLabelInput(label: string): void {
    this.patchTagDraft({ label });
    if (!this.editingTagId() && !this.tagDraft().id.trim()) {
      this.patchTagDraft({ id: this.curation.suggestTagId(label) });
    }
  }

  saveTag(): void {
    this.run(() => {
      const draft = this.tagDraft();
      const tag = this.curation.draftToBoardTag(draft);
      if (!this.curation.isBoardTagIdAvailable(tag.id, this.editingTagId() ?? undefined)) {
        throw new Error(`Tag id "${tag.id}" is already in use`);
      }
      this.curation.upsertBoardTag(tag);
      this.resetTagForm();
    });
  }

  removeTag(tagId: string): void {
    if (!confirm('Remove this tag? It will be cleared from all items.')) return;
    this.run(() => {
      this.curation.removeBoardTag(tagId);
      if (this.editingTagId() === tagId) this.resetTagForm();
      this.nodeDraft.update((d) => ({
        ...d,
        tags: d.tags.filter((id) => id !== tagId),
      }));
    });
  }

  startNewNode(): void {
    this.ui.requestNewItem();
  }

  editNode(node: AboardNode): void {
    this.ui.selectNodeForEdit(node.id);
  }

  onNodeTypeChange(type: string): void {
    this.nodeDraft.update((d) => ({
      ...d,
      type,
      category: this.curation.defaultCategoryForType(type),
    }));
  }

  toggleNodeTag(tagId: string): void {
    this.nodeDraft.update((d) => {
      const selected = new Set(d.tags);
      selected.has(tagId) ? selected.delete(tagId) : selected.add(tagId);
      return { ...d, tags: [...selected] };
    });
  }

  isNodeTagSelected(tagId: string): boolean {
    return this.nodeDraft().tags.includes(tagId);
  }

  saveNode(): void {
    this.run(() => {
      const draft = this.nodeDraft();
      const node = this.curation.draftToNode(draft);
      if (!this.curation.isNodeIdAvailable(node.id, this.editingNodeId() ?? undefined)) {
        throw new Error(`Node id "${node.id}" is already in use`);
      }
      this.curation.upsertNode(node);
      this.resetNodeForm();
    });
  }

  removeSelectedNode(): void {
    const nodeId = this.ui.editingNodeId();
    if (!nodeId) return;
    this.removeNode(nodeId);
  }

  canRemoveSelectedNode(): boolean {
    const nodeId = this.ui.editingNodeId();
    return !!nodeId && nodeId !== this.doc.currentDocument().rootId;
  }

  removeNode(nodeId: string): void {
    if (!confirm('Remove this node and its relationships? Child nodes will move up one level.')) {
      return;
    }
    this.run(() => {
      this.curation.removeNode(nodeId);
      if (this.editingNodeId() === nodeId) this.resetNodeForm();
    });
  }

  startNewRelationship(): void {
    this.editingRelId.set(null);
    this.relDraft.set(this.curation.emptyRelationshipDraft());
    this.error.set(null);
  }

  editRelationship(rel: AboardRelationship): void {
    this.editingRelId.set(rel.id);
    this.relDraft.set(this.curation.relationshipToDraft(rel));
    this.error.set(null);
  }

  saveRelationship(): void {
    this.run(() => {
      const draft = this.relDraft();
      const rel = this.curation.draftToRelationship(draft);
      if (!this.curation.isRelationshipIdAvailable(rel.id, this.editingRelId() ?? undefined)) {
        throw new Error(`Relationship id "${rel.id}" is already in use`);
      }
      this.curation.upsertRelationship(rel);
      this.resetRelForm();
    });
  }

  removeRelationship(relId: string): void {
    if (!confirm('Remove this relationship?')) return;
    this.run(() => {
      this.curation.removeRelationship(relId);
      if (this.editingRelId() === relId) this.resetRelForm();
    });
  }

  startNewSchemaType(): void {
    this.editingSchemaId.set(null);
    this.schemaDraft.set(this.curation.emptySchemaTypeDraft());
    this.error.set(null);
  }

  editSchemaType(type: SchemaType): void {
    this.editingSchemaId.set(type.id);
    this.schemaDraft.set(this.curation.schemaTypeToDraft(type));
    this.error.set(null);
  }

  saveSchemaType(): void {
    this.run(() => {
      const draft = this.schemaDraft();
      const type = this.curation.draftToSchemaType(draft);
      if (!this.curation.isSchemaTypeIdAvailable(type.id, this.editingSchemaId() ?? undefined)) {
        throw new Error(`Schema type id "${type.id}" is already in use`);
      }
      this.curation.upsertSchemaType(type);
      this.resetSchemaForm();
    });
  }

  removeSchemaType(typeId: string): void {
    if (!confirm('Remove this schema type? Nodes keep their type but revert to default styling.')) {
      return;
    }
    this.run(() => {
      this.curation.removeSchemaType(typeId);
      if (this.editingSchemaId() === typeId) this.resetSchemaForm();
    });
  }

  nodeLabel(id: string): string {
    return this.doc.findNode(id)?.label ?? id;
  }

  tagLabel = tagLabel;

  patchNodeDraft(partial: Partial<NodeDraft>): void {
    this.nodeDraft.update((d) => ({ ...d, ...partial }));
  }

  patchRelDraft(partial: Partial<RelationshipDraft>): void {
    this.relDraft.update((d) => ({ ...d, ...partial }));
  }

  patchSchemaDraft(partial: Partial<SchemaTypeDraft>): void {
    this.schemaDraft.update((d) => ({ ...d, ...partial }));
  }

  patchTagDraft(partial: Partial<BoardTagDraft>): void {
    this.tagDraft.update((d) => ({ ...d, ...partial }));
  }

  private resetNodeForm(): void {
    this.ui.editingNodeId.set(null);
    this.nodeDraft.set(this.curation.emptyNodeDraft());
  }

  private resetRelForm(): void {
    this.editingRelId.set(null);
    this.relDraft.set(this.curation.emptyRelationshipDraft());
  }

  private resetSchemaForm(): void {
    this.editingSchemaId.set(null);
    this.schemaDraft.set(this.curation.emptySchemaTypeDraft());
  }

  private resetTagForm(): void {
    this.editingTagId.set(null);
    this.tagDraft.set(this.curation.emptyBoardTagDraft());
  }

  private run(action: () => void): void {
    try {
      action();
      this.error.set(null);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}

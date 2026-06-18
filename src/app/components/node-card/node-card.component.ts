import { Component, input, output, inject, computed } from '@angular/core';
import { AboardNode } from '../../models/aboard.models';
import { DocumentService } from '../../services/document.service';

@Component({
  selector: 'app-node-card',
  templateUrl: './node-card.component.html',
  styleUrl: './node-card.component.scss',
})
export class NodeCardComponent {
  readonly node = input.required<AboardNode>();
  readonly selected = input(false);

  readonly explore = output<void>();
  readonly select = output<void>();

  protected readonly doc = inject(DocumentService);

  protected readonly hasChildren = computed(() =>
    this.doc.hasChildren(this.node().id)
  );

  protected readonly childCount = computed(() =>
    this.doc.getChildren(this.node().id).length
  );

  protected readonly relationshipCount = computed(() =>
    this.doc.getRelationshipsFor(this.node().id).length
  );

  protected typeLabel(type: string): string {
    return type.replace(/-/g, ' ');
  }

  protected onCardClick(): void {
    this.select.emit();
  }

  protected onExplore(event: MouseEvent): void {
    event.stopPropagation();
    this.explore.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.select.emit();
    }
  }
}

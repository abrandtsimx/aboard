import { KeyValuePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { DocumentService } from '../../services/document.service';
import { AboardRelationship } from '../../models/aboard.models';

@Component({
  selector: 'app-detail-panel',
  imports: [KeyValuePipe],
  templateUrl: './detail-panel.component.html',
  styleUrl: './detail-panel.component.scss',
})
export class DetailPanelComponent {
  protected readonly doc = inject(DocumentService);

  protected resolveLabel(id: string): string {
    return this.doc.findNode(id)?.label ?? id;
  }

  protected relationshipText(rel: AboardRelationship): string {
    const selected = this.doc.selectedNode();
    if (!selected) return rel.label ?? rel.type;

    const isSource = rel.sourceId === selected.id;
    const otherId = isSource ? rel.targetId : rel.sourceId;
    const other = this.resolveLabel(otherId);
    const verb = rel.label ?? rel.type.replace(/-/g, ' ');

    if (rel.bidirectional) {
      return `${selected.label} ↔ ${other}: ${verb}`;
    }
    return isSource
      ? `${selected.label} → ${other}: ${verb}`
      : `${other} → ${selected.label}: ${verb}`;
  }

  protected close(): void {
    this.doc.selectNode(null);
  }
}

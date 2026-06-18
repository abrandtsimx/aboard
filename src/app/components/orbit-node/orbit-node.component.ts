import { NgClass } from '@angular/common';
import { Component, input, output, inject, computed } from '@angular/core';
import { AboardNode, NodeShape } from '../../models/aboard.models';
import { DocumentService } from '../../services/document.service';
import { resolveNodeStyle } from '../../utils/node-style.util';

// Fraction of the node's pixel box that is actually usable for the label, per
// shape. These mirror the per-shape CSS padding (the visual buffer between the
// label and the shape edge) so the computed font fits inside the same content
// box the layout already reserves:
//   - rounded-square / square: 16% padding -> ~0.68 usable
//   - circle:                  20% padding + curvature -> ~0.60 usable
//   - diamond:                 inscribed rectangle is ~half the box -> ~0.48
//   - hexagon:                 17% side / 12% top-bottom padding; full width
//                              only in the middle band -> wider tall budget
const SHAPE_FIT: Record<NodeShape, { w: number; h: number }> = {
  circle: { w: 0.6, h: 0.6 },
  'rounded-square': { w: 0.68, h: 0.68 },
  square: { w: 0.68, h: 0.68 },
  pill: { w: 0.76, h: 0.52 },
  ellipse: { w: 0.66, h: 0.58 },
  diamond: { w: 0.48, h: 0.48 },
  hexagon: { w: 0.64, h: 0.74 },
  octagon: { w: 0.64, h: 0.64 },
};

// Typography model for the label (uppercase Lato Bold + 0.04em tracking).
// CHAR_W is the average glyph advance in `em` (including letter-spacing); it
// lets us estimate how wide a word/line is at a given font size without
// measuring the DOM. FILL keeps text from touching the content-box edge.
const CHAR_W = 0.66;
const LINE_H = 1.12;
const FILL = 0.9;
const MIN_FONT = 8;
const MAX_FONT = 15;

export type OrbitState =
  | 'default'
  | 'peek'
  | 'dimmed'
  | 'focus'
  | 'satellite'
  | 'related'
  | 'intermediate'
  | 'creator';

@Component({
  selector: 'app-orbit-node',
  imports: [NgClass],
  templateUrl: './orbit-node.component.html',
  styleUrl: './orbit-node.component.scss',
})
export class OrbitNodeComponent {
  readonly node = input.required<AboardNode>();
  readonly state = input<OrbitState>('default');
  readonly subtitle = input<string | null>(null);
  readonly interactive = input(true);
  /** Rendered diameter/side of the node in CSS pixels (from the layout). */
  readonly pxSize = input<number>(120);

  readonly activated = output<void>();

  protected readonly doc = inject(DocumentService);

  protected readonly category = computed(() => this.doc.getCategory(this.node()));

  // Shape/colors come from the board's schema when it defines this node's type;
  // otherwise we fall back to the built-in category styling.
  protected readonly style = computed(() =>
    resolveNodeStyle(this.node(), this.doc.schema(), this.doc.currentDocument())
  );
  protected readonly shape = computed(() => this.style().shape);
  protected readonly fillColor = computed(() => this.style().fill);
  protected readonly textColor = computed(() => this.style().textColor);

  protected readonly childCount = computed(() =>
    this.doc.getChildren(this.node().id).length
  );

  protected readonly showDetails = computed(() => this.state() === 'peek');

  // Modulate the label font so it always fits inside the shape's usable area
  // with a buffer, scaling down for longer labels and/or smaller nodes. Two
  // constraints are evaluated and the smaller font wins:
  //   1. word constraint  — the longest word must fit on one line (we never
  //      break words mid-word), so font <= FILL * usableWidth / (chars * CHAR_W)
  //   2. block constraint — the whole label must fit in the usable box across
  //      wrapped lines: capacity = (W / (f·CHAR_W)) · (H / (f·LINE_H)) >= chars,
  //      which solves to font <= sqrt(FILL · W · H / (chars · CHAR_W · LINE_H))
  // The result is clamped to [MIN_FONT, MAX_FONT] so short labels in big nodes
  // never balloon and long labels in small nodes stay readable.
  protected readonly labelFontSize = computed(() => {
    const px = this.pxSize();
    const fit = SHAPE_FIT[this.shape()] ?? SHAPE_FIT['rounded-square'];
    const usableW = px * fit.w;
    const usableH = px * fit.h;

    const label = (this.node().label ?? '').trim();
    if (!label) return MAX_FONT;
    const words = label.split(/\s+/);
    const longestWord = words.reduce((max, w) => Math.max(max, w.length), 1);
    const totalChars = label.replace(/\s+/g, ' ').length;

    const fontByWord = (FILL * usableW) / (longestWord * CHAR_W);
    const fontByBlock = Math.sqrt(
      (FILL * usableW * usableH) / (totalChars * CHAR_W * LINE_H)
    );

    const font = Math.min(fontByWord, fontByBlock, MAX_FONT);
    return Math.max(MIN_FONT, Math.round(font * 10) / 10);
  });

  protected orbitClasses(): Record<string, boolean> {
    const cat = this.category();
    return {
      [`orbit--cat-${cat}`]: true,
      [`orbit--shape-${this.shape()}`]: true,
      [`orbit--${this.state()}`]: true,
      'orbit--static': !this.interactive(),
      'orbit--tagged-application': cat === 'application' && !!this.style().fill,
    };
  }

  protected onClick(event: MouseEvent): void {
    event.stopPropagation();
    if (this.interactive()) this.activated.emit();
  }
}

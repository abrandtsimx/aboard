import {
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { AboardNode } from '../../models/aboard.models';
import {
  MentionCandidate,
  MentionState,
  filterMentionCandidates,
  findActiveMention,
  insertReferenceToken,
} from '../../utils/item-reference.util';

@Component({
  selector: 'app-item-reference-input',
  standalone: true,
  templateUrl: './item-reference-input.component.html',
  styleUrl: './item-reference-input.component.scss',
})
export class ItemReferenceInputComponent {
  readonly value = input('');
  readonly nodes = input<AboardNode[]>([]);
  readonly multiline = input(false);
  readonly rows = input(5);
  readonly placeholder = input('');
  readonly name = input('');
  readonly excludeNodeId = input<string | undefined>(undefined);

  readonly valueChange = output<string>();

  private readonly inputRef = viewChild<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(
    'field'
  );

  protected readonly mention = signal<MentionState | null>(null);
  protected readonly highlightIndex = signal(0);

  protected readonly menuOpen = computed(() => this.mention() != null);

  protected readonly candidates = computed(() => {
    const state = this.mention();
    if (!state) return [] as MentionCandidate[];
    return filterMentionCandidates(
      this.nodes().map((n) => ({ id: n.id, label: n.label })),
      state.query,
      this.excludeNodeId()
    );
  });

  protected onInput(event: Event): void {
    const el = event.target as HTMLInputElement | HTMLTextAreaElement;
    const cursor = el.selectionStart ?? el.value.length;
    this.valueChange.emit(el.value);
    this.syncMention(el.value, cursor);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.menuOpen()) return;

    const items = this.candidates();
    if (items.length === 0) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeMention();
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.highlightIndex.update((i) => (i + 1) % items.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlightIndex.update((i) => (i - 1 + items.length) % items.length);
      return;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.applyCandidate(items[this.highlightIndex()]);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMention();
    }
  }

  protected onBlur(): void {
    window.setTimeout(() => this.closeMention(), 120);
  }

  protected selectCandidate(candidate: MentionCandidate, event: MouseEvent): void {
    event.preventDefault();
    this.applyCandidate(candidate);
  }

  private syncMention(text: string, cursor: number): void {
    const state = findActiveMention(text, cursor);
    this.mention.set(state);
    this.highlightIndex.set(0);
  }

  private applyCandidate(candidate: MentionCandidate): void {
    const state = this.mention();
    if (!state) return;

    const { text, cursor } = insertReferenceToken(this.value(), state, candidate.id);
    this.valueChange.emit(text);
    this.closeMention();

    queueMicrotask(() => {
      const el = this.inputRef()?.nativeElement;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  private closeMention(): void {
    this.mention.set(null);
    this.highlightIndex.set(0);
  }
}

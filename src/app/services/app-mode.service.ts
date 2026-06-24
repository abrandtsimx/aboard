import { Injectable, computed, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AppModeService {
  private readonly shareView = signal(false);

  readonly isShareView = this.shareView.asReadonly();
  readonly readOnly = computed(() => this.shareView());

  enterShareView(): void {
    this.shareView.set(true);
  }

  exitShareView(): void {
    this.shareView.set(false);
  }
}

import { Component, inject } from '@angular/core';
import { ToastService } from '../ui';

/** Toast notifications shown at the top-right corner. Add once in the root component. */
@Component({
  selector: 'app-toasts',
  templateUrl: './toasts.html',
  styleUrl: './toasts.scss',
})
export class ToastsComponent {
  toast = inject(ToastService);
}

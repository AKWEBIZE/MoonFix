import { Component, input } from '@angular/core';

/** Small animated appliance illustration for service cards (AC airflow, fridge frost, spinning washer). */
@Component({
  selector: 'app-appliance-anim',
  templateUrl: './appliance-anim.html',
  styleUrl: './appliance-anim.scss',
})
export class ApplianceAnim {
  category = input.required<string>();
}

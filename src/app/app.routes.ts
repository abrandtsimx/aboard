import { Routes } from '@angular/router';
import { RouteHostComponent } from './components/route-host/route-host.component';

export const routes: Routes = [
  { path: 'share', component: RouteHostComponent },
  { path: '**', component: RouteHostComponent },
];

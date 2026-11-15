/* M5 Nutrition (portal). Client: /client/nutrition and a Home card. Coach: the Nutrition tab of the client record, the
   meal plan editor (/coach/meal-plans/:id) and the library (/coach/nutrition-library). Admin: the team library
   (/admin/nutrition-library, library.manage). Pages load lazily; the server enforces every rule again. */
import React from 'react';
import type { ClientRecordTabContext, PortalModule } from '../types';
import { Skeleton } from '../../ui';

const h = React.createElement;
const ClientNutrition = React.lazy(() => import('./ClientNutrition').then((m) => ({ default: m.ClientNutrition })));
const MealPlanEditor = React.lazy(() => import('./MealPlanEditor').then((m) => ({ default: m.MealPlanEditor })));
const NutritionLibrary = React.lazy(() => import('./NutritionLibrary').then((m) => ({ default: m.NutritionLibrary })));
const CoachNutritionTab = React.lazy(() => import('./CoachNutritionTab').then((m) => ({ default: m.CoachNutritionTab })));
const NutritionHomeCard = React.lazy(() => import('./HomeCard').then((m) => ({ default: m.NutritionHomeCard })));

/** Tabs and cards draw inside an existing page, so they wait in place rather than blanking the page. */
const inPlace = (node: React.ReactNode, rows = 4) => h(React.Suspense, { fallback: h(Skeleton, { rows }) }, node);

export const nutrition: PortalModule = {
  key: 'nutrition',
  title: 'Nutrition',
  routes: [
    { workspace: 'client', path: 'nutrition', element: h(ClientNutrition) },
    { workspace: 'coach', path: 'meal-plans/:id', element: h(MealPlanEditor) },
    { workspace: 'coach', path: 'nutrition-library', element: h(NutritionLibrary, { mode: 'coach' }) },
    { workspace: 'admin', path: 'nutrition-library', permission: 'library.manage', element: h(NutritionLibrary, { mode: 'admin' }) },
  ],
  nav: [
    { workspace: 'client', to: '/nutrition', label: 'Nutrition', before: '/bespoke' },
    { workspace: 'coach', to: '/nutrition-library', label: 'Nutrition library', group: 'Libraries' },
    { workspace: 'admin', to: '/nutrition-library', label: 'Nutrition library', permission: 'library.manage', group: 'Libraries' },
  ],
  clientTabs: [
    { id: 'nutrition', label: 'Nutrition', workspaces: ['coach'], render: (ctx: ClientRecordTabContext) => inPlace(h(CoachNutritionTab, ctx), 5) },
  ],
  cards: [
    { id: 'nutrition-today', placement: 'clientHome', span: 6, render: () => inPlace(h(NutritionHomeCard), 3) },
  ],
};

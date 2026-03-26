import { inject } from 'vue';

export const dashboardKey = Symbol('dashboard');

export const useDashboard = () => {
  const dashboard = inject(dashboardKey);

  if (!dashboard) {
    throw new Error('dashboard context not found');
  }

  return dashboard;
};

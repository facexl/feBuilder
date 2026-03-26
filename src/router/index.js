import { createRouter, createWebHistory } from 'vue-router';
import LoginPage from '../pages/LoginPage.vue';
import ProjectsPage from '../pages/ProjectsPage.vue';
import UsersPage from '../pages/UsersPage.vue';
import AuditsPage from '../pages/AuditsPage.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/login',
    },
    {
      path: '/login',
      component: LoginPage,
    },
    {
      path: '/projects',
      component: ProjectsPage,
    },
    {
      path: '/users',
      component: UsersPage,
    },
    {
      path: '/audits',
      component: AuditsPage,
    },
  ],
});

export default router;

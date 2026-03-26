import { inject } from 'vue';

export const authKey = Symbol('auth');

export const useAuth = () => {
  const auth = inject(authKey);

  if (!auth) {
    throw new Error('auth context not found');
  }

  return auth;
};

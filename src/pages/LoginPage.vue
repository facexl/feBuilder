<script setup>
import { useAuth } from '../context/auth';

const auth = useAuth();
</script>

<template>
  <section class="login-card">
    <div class="panel-tag">Cloud Build Console</div>
    <h1>云打包工具</h1>
    <p class="muted">Node.js + Vue + JSON 文件存储</p>

    <form class="stack" @submit.prevent="auth.handleLogin">
      <label>
        <span>账户</span>
        <input v-model.trim="auth.loginForm.account" placeholder="请输入账户" />
      </label>

      <label>
        <span>密码</span>
        <input
          v-model="auth.loginForm.password"
          type="password"
          placeholder="请输入密码"
        />
      </label>

      <button class="primary-btn" :disabled="auth.loading.value">
        {{ auth.loading.value ? '登录中...' : '登录' }}
      </button>
    </form>

    <p v-if="auth.loginError.value" class="error-text">{{ auth.loginError.value }}</p>
  </section>
</template>

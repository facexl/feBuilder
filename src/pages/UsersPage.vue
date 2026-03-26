<script setup>
import { useDashboard } from '../context/dashboard';

const dashboard = useDashboard();
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>用户管理</h2>
        <p class="muted">只有 admin 账户可以查看和配置用户权限</p>
      </div>
      <button class="primary-btn" @click="dashboard.openCreateUserModal">创建用户</button>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>账户</th>
            <th>项目权限</th>
            <th>角色</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="dashboard.users.value.length === 0">
            <td colspan="4">暂无用户</td>
          </tr>
          <tr v-for="user in dashboard.users.value" :key="user.account">
            <td>{{ user.account }}</td>
            <td>{{ dashboard.formatPermissions(user.projectPermissions) }}</td>
            <td>{{ user.isAdmin ? 'admin' : '普通用户' }}</td>
            <td class="row-actions">
              <button class="mini-btn" @click="dashboard.editUser(user)">编辑</button>
              <button
                class="mini-btn danger"
                :disabled="user.isAdmin"
                @click="dashboard.removeUser(user.account)"
              >
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

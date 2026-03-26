<script setup>
import { useDashboard } from '../context/dashboard';

const dashboard = useDashboard();
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>操作审计</h2>
        <p class="muted">仅 admin 可查看，记录登录、项目操作、执行操作和用户变更。</p>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>操作人</th>
            <th>动作</th>
            <th>对象</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="dashboard.auditLogs.value.length === 0">
            <td colspan="5">暂无审计记录</td>
          </tr>
          <tr v-for="audit in dashboard.auditLogs.value" :key="audit.id">
            <td>{{ dashboard.formatDate(audit.createdAt) }}</td>
            <td>{{ audit.actorAccount }}</td>
            <td>{{ audit.action }}</td>
            <td>{{ audit.targetType }} / {{ audit.targetId }}</td>
            <td>{{ audit.detail }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

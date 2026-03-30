<script setup>
import { useDashboard } from '../context/dashboard';

const dashboard = useDashboard();
</script>

<template>
  <section class="panel project-table-panel">
    <div class="panel-head project-toolbar">
      <div>
        <h2>项目列表</h2>
      </div>
      <button class="primary-btn" @click="dashboard.openCreateProjectModal">创建项目</button>
    </div>

    <div class="tab-container">
      <div class="project-tabs">
        <button
          class="filter-tab"
          :class="{ active: dashboard.projectTypeFilter.value === 'testing' }"
          @click="dashboard.projectTypeFilter.value = 'testing'"
        >
          测试环境
        </button>
        <button
          class="filter-tab"
          :class="{ active: dashboard.projectTypeFilter.value === 'production' }"
          @click="dashboard.projectTypeFilter.value = 'production'"
        >
          线上环境
        </button>
      </div>

      <div class="organization-tabs" v-if="dashboard.availableOrganizations.value.length > 0">
        <button
          class="org-tab"
          :class="{ active: !dashboard.organizationFilter.value }"
          @click="dashboard.organizationFilter.value = ''"
        >
          全部
        </button>
        <button
          v-for="org in dashboard.availableOrganizations.value"
          :key="org.id"
          class="org-tab"
          :class="{ active: dashboard.organizationFilter.value === org.id }"
          @click="dashboard.organizationFilter.value = org.id"
        >
          {{ org.name }}
        </button>
      </div>
      </div>

      <div class="table-wrap project-table-wrap">
      <table class="project-table">
        <thead>
          <tr>
            <th class="col-name">项目</th>
            <th class="col-org">组织</th>
            <th class="col-env">运行环境</th>
            <th class="col-status">最近执行</th>
            <th class="col-time">时间</th>
            <th class="col-actions sticky-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="dashboard.filteredProjects.value.length === 0">
            <td colspan="6">暂无项目</td>
          </tr>
          <tr
            v-for="project in dashboard.filteredProjects.value"
            :key="project.id"
            :class="{ 'selected-row': dashboard.selectedProjectId.value === project.id }"
          >
            <td>
              <div class="project-name-cell">
                <div class="project-title-row">
                  <strong>{{ project.name }}</strong>
                  <span class="type-badge" :class="dashboard.projectTypeClass(project.type)">
                    {{ dashboard.projectTypeLabel(project.type) }}
                  </span>
                </div>
                <span class="cell-subtext">
                  {{ project.isRunning ? '当前正在执行' : '可见即有操作权限' }}
                </span>
                <span v-if="project.autoBuildEnabled" class="cell-subtext auto-build-text">
                  自动执行：{{ project.watchBranch || '未选择分支' }}
                </span>
              </div>
            </td>
            <td>
              <span v-if="project.organizationId">
                {{ dashboard.organizationNameMap.value[project.organizationId] || '未知组织' }}
              </span>
              <span v-else class="cell-subtext">未设置</span>
            </td>
            <td>
              <div class="env-cell">
                <div>
                  <span class="summary-label">Node.js</span>
                  <strong>{{ project.nodeVersion }}</strong>
                </div>
                <div>
                  <span class="summary-label">包管理器</span>
                  <strong>{{ project.packageManager }}</strong>
                </div>
              </div>
            </td>
            <td>
              <span class="status-pill" :class="project.latestExecution?.status || 'idle'">
                {{
                  dashboard.statusLabel(
                    project.latestExecution?.status || (project.isRunning ? 'running' : 'idle')
                  )
                }}
              </span>
              <div class="cell-subtext">
                {{ dashboard.formatDate(project.latestExecution?.startedAt) }}
              </div>
              <div class="cell-subtext">
                最近执行人：{{ project.latestExecution?.operatorAccount || '-' }}
              </div>
              <div
                v-if="project.latestExecution?.lastErrorExcerpt"
                class="cell-subtext error-subtext"
              >
                {{ project.latestExecution.lastErrorExcerpt }}
              </div>
            </td>
            <td>
              <div class="time-cell">
                <div>
                  <span class="summary-label">创建</span>
                  <strong>{{ dashboard.formatDate(project.createdAt) }}</strong>
                </div>
                <div>
                  <span class="summary-label">更新</span>
                  <strong>{{ dashboard.formatDate(project.updatedAt) }}</strong>
                </div>
              </div>
            </td>
            <td class="sticky-actions-cell">
              <div class="row-actions">
                <template v-if="project.isRunning">
                  <button class="mini-btn primary-mini" disabled>执行中...</button>
                  <button class="mini-btn warn" @click="dashboard.stopProject(project)">
                    停止
                  </button>
                </template>
                <div
                  v-else
                  class="run-button-wrap"
                  :class="{ production: project.type === 'production' }"
                >
                  <button
                    class="mini-btn primary-mini"
                    :class="{ 'danger-run': project.type === 'production' }"
                    @click="dashboard.runProject(project)"
                  >
                    执行
                  </button>
                  <span v-if="project.type === 'production'" class="run-tooltip">线上环境！</span>
                </div>
                <button class="mini-btn" @click="dashboard.openProjectHistory(project.id)">
                  详情
                </button>
                <button class="mini-btn" @click="dashboard.copyProject(project)">复制</button>
                <button class="mini-btn" @click="dashboard.editProject(project)">编辑</button>
                <button class="mini-btn danger" @click="dashboard.removeProject(project.id)">
                  删除
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

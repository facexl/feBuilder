<script setup>
import {
  computed,
  onBeforeUnmount,
  onMounted,
  provide,
  reactive,
  ref,
  watch,
} from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { dashboardKey } from './context/dashboard';
import { authKey } from './context/auth';

const router = useRouter();
const route = useRoute();

const token = ref(localStorage.getItem('token') || '');
const currentUser = ref(null);
const loading = ref(false);
const loginError = ref('');
const toast = ref({
  visible: false,
  type: 'success',
  text: '',
});
const projects = ref([]);
const users = ref([]);
const auditLogs = ref([]);
const organizations = ref([]);
const executionHistory = ref([]);
const selectedProjectId = ref('');
const selectedExecutionId = ref('');
const editingUserAccount = ref('');
const repoBranches = ref([]);
const repoBranchLoading = ref(false);
const repoBranchError = ref('');
const showProjectModal = ref(false);
const showExecutionModal = ref(false);
const showUserModal = ref(false);
const isExecutionFullscreen = ref(true);
const initialProjectEnv = route.query.env === 'production' ? 'production' : 'testing';
const projectTypeFilter = ref(initialProjectEnv);
const organizationFilter = ref('');
const projectOptions = ref({
  projectTypes: ['production', 'testing'],
  nodeVersions: ['16.16.0', '18.16.0', '22.22.0', '24.14.0', '20.20.1'],
  packageManagers: ['pnpm', 'npm', 'yarn'],
});
let projectPollingTimer = null;
let toastTimer = null;
let repoBranchFetchTimer = null;

const loginForm = reactive({
  account: '',
  password: '',
});

const projectForm = reactive({
  id: '',
  name: '',
  type: 'testing',
  nodeVersion: '20.20.1',
  packageManager: 'pnpm',
  autoBuildEnabled: false,
  repoSshUrl: '',
  watchBranch: '',
  script: '',
  organizationId: '',
  newOrganizationName: '',
});

const userForm = reactive({
  account: '',
  password: '',
  projectPermissions: [],
});

const isAdmin = computed(() => currentUser.value?.isAdmin);
const isEditingProject = computed(() => Boolean(projectForm.id));
const isEditingUser = computed(() => Boolean(editingUserAccount.value));
const projectNameMap = computed(() =>
  Object.fromEntries(projects.value.map((project) => [project.id, project.name]))
);
const organizationNameMap = computed(() =>
  Object.fromEntries(organizations.value.map((org) => [org.id, org.name]))
);
const selectedProject = computed(
  () => projects.value.find((project) => project.id === selectedProjectId.value) || null
);
const selectedExecution = computed(
  () =>
    executionHistory.value.find((item) => item.id === selectedExecutionId.value) ||
    executionHistory.value[0] ||
    null
);
const hasRunningProject = computed(() =>
  projects.value.some((project) => project.isRunning)
);
const filteredProjects = computed(() =>
  projects.value.filter((project) => {
    const typeMatch = project.type === projectTypeFilter.value;
    const orgMatch = !organizationFilter.value || project.organizationId === organizationFilter.value;
    return typeMatch && orgMatch;
  })
);
const availableOrganizations = computed(() => {
  const orgIds = new Set(
    projects.value
      .filter((p) => p.type === projectTypeFilter.value && p.organizationId)
      .map((p) => p.organizationId)
  );
  return organizations.value.filter((org) => orgIds.has(org.id));
});

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token.value}`,
});

const request = async (url, options = {}) => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || '请求失败');
  }

  return data;
};

const showToast = (type, text) => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }

  toast.value = {
    visible: true,
    type,
    text,
  };

  toastTimer = window.setTimeout(() => {
    toast.value.visible = false;
  }, 2600);
};

const formatDate = (value) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
};

const formatPermissions = (permissionIds) => {
  if (!permissionIds?.length) return '-';
  return permissionIds
    .map((id) => `${projectNameMap.value[id] || '未知项目'}（${id}）`)
    .join('、');
};

const statusLabel = (status) => {
  if (status === 'running') return '执行中';
  if (status === 'success') return '成功';
  if (status === 'error') return '失败';
  if (status === 'stopped') return '已停止';
  return '未执行';
};

const projectTypeLabel = (type) => (type === 'production' ? '线上环境' : '测试环境');
const projectTypeClass = (type) => (type === 'production' ? 'production' : 'testing');

const normalizeProject = (project) => ({
  ...project,
  type: project.type === 'production' ? 'production' : 'testing',
  nodeVersion: project.nodeVersion || projectOptions.value.nodeVersions[0] || '20.20.1',
  packageManager:
    project.packageManager || projectOptions.value.packageManagers[0] || 'pnpm',
  autoBuildEnabled: Boolean(project.autoBuildEnabled),
  repoSshUrl: project.repoSshUrl || '',
  watchBranch: project.watchBranch || '',
  lastSeenCommit: project.lastSeenCommit || '',
  lastTriggeredCommit: project.lastTriggeredCommit || '',
  lastPolledAt: project.lastPolledAt || null,
});

const progressWidth = (status) => {
  if (status === 'running') return '72%';
  if (status === 'success' || status === 'error' || status === 'stopped') return '100%';
  return '0%';
};

const formatDuration = (durationMs) => {
  if (durationMs == null || durationMs < 0) return '-';
  if (durationMs < 1000) return `${durationMs}ms`;

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${remainSeconds}s`;
};

const resetProjectForm = () => {
  projectForm.id = '';
  projectForm.name = '';
  projectForm.type = 'testing';
  projectForm.nodeVersion = projectOptions.value.nodeVersions[0] || '20.20.1';
  projectForm.packageManager = projectOptions.value.packageManagers[0] || 'pnpm';
  projectForm.autoBuildEnabled = false;
  projectForm.repoSshUrl = '';
  projectForm.watchBranch = '';
  projectForm.script = '';
  projectForm.organizationId = '';
  projectForm.newOrganizationName = '';
  repoBranches.value = [];
  repoBranchError.value = '';
  repoBranchLoading.value = false;
};

const closeProjectModal = () => {
  showProjectModal.value = false;
  resetProjectForm();
};

const openCreateProjectModal = () => {
  resetProjectForm();
  showProjectModal.value = true;
};

const mergeRepoBranches = (branches, currentBranch = projectForm.watchBranch) => {
  const uniqueBranches = Array.from(
    new Set([...(branches || []), currentBranch].filter(Boolean))
  );
  repoBranches.value = uniqueBranches;
};

const fetchRepoBranches = async ({ silent = false } = {}) => {
  if (!projectForm.autoBuildEnabled || !projectForm.repoSshUrl.trim()) {
    repoBranches.value = projectForm.watchBranch ? [projectForm.watchBranch] : [];
    repoBranchError.value = '';
    repoBranchLoading.value = false;
    return;
  }

  repoBranchLoading.value = true;
  if (!silent) {
    repoBranchError.value = '';
  }

  try {
    const data = await request('/api/git/branches', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        repoSshUrl: projectForm.repoSshUrl.trim(),
      }),
    });
    mergeRepoBranches(data.branches || []);
    repoBranchError.value = '';
    if (!projectForm.watchBranch && repoBranches.value.length) {
      projectForm.watchBranch = repoBranches.value[0];
    }
  } catch (error) {
    mergeRepoBranches([], projectForm.watchBranch);
    repoBranchError.value = error.message;
    if (!silent) {
      showToast('error', error.message);
    }
  } finally {
    repoBranchLoading.value = false;
  }
};

const resetUserForm = () => {
  editingUserAccount.value = '';
  userForm.account = '';
  userForm.password = '';
  userForm.projectPermissions = [];
};

const closeUserModal = () => {
  showUserModal.value = false;
  resetUserForm();
};

const openCreateUserModal = () => {
  resetUserForm();
  showUserModal.value = true;
};

const stopProjectPolling = () => {
  if (projectPollingTimer) {
    window.clearInterval(projectPollingTimer);
    projectPollingTimer = null;
  }
};

const syncProjectSelection = () => {
  if (!projects.value.length) {
    selectedProjectId.value = '';
    selectedExecutionId.value = '';
    executionHistory.value = [];
    return;
  }

  const exists = projects.value.some((project) => project.id === selectedProjectId.value);
  if (!exists) {
    selectedProjectId.value = projects.value[0].id;
  }
};

const syncExecutionSelection = () => {
  if (!executionHistory.value.length) {
    selectedExecutionId.value = '';
    return;
  }

  const exists = executionHistory.value.some(
    (execution) => execution.id === selectedExecutionId.value
  );
  if (!exists) {
    selectedExecutionId.value = executionHistory.value[0].id;
  }
};

const fetchProjects = async () => {
  const data = await request('/api/projects', {
    headers: authHeaders(),
  });
  projects.value = data.map(normalizeProject);
  syncProjectSelection();
};

const fetchProjectOptions = async () => {
  projectOptions.value = await request('/api/project-options', {
    headers: authHeaders(),
  });
};

const fetchUsers = async () => {
  if (!isAdmin.value) return;
  users.value = await request('/api/users', {
    headers: authHeaders(),
  });
};

const fetchAudits = async () => {
  if (!isAdmin.value) return;
  auditLogs.value = await request('/api/audits', {
    headers: authHeaders(),
  });
};

const fetchOrganizations = async () => {
  organizations.value = await request('/api/organizations', {
    headers: authHeaders(),
  });
};

const fetchProjectExecutions = async (projectId = selectedProjectId.value) => {
  if (!projectId) {
    executionHistory.value = [];
    selectedExecutionId.value = '';
    return;
  }

  executionHistory.value = await request(`/api/projects/${projectId}/executions`, {
    headers: authHeaders(),
  });
  syncExecutionSelection();
};

const refreshProjectArea = async () => {
  await fetchProjects();
  await fetchProjectExecutions();
};

const updateProjectPolling = () => {
  if (hasRunningProject.value) {
    if (!projectPollingTimer) {
      projectPollingTimer = window.setInterval(async () => {
        try {
          await refreshProjectArea();
        } catch {
          stopProjectPolling();
        }
      }, 2000);
    }
    return;
  }

  stopProjectPolling();
};

const fetchMe = async () => {
  if (!token.value) return;
  const data = await request('/api/me', {
    headers: authHeaders(),
  });
  currentUser.value = data.user;
};

const syncRouteAfterLogin = () => {
  if (route.path === '/login' || route.path === '/') {
    router.replace('/projects');
    return;
  }

  if (!isAdmin.value && route.path !== '/projects') {
    router.replace('/projects');
    return;
  }
};

const loadDashboard = async () => {
  if (!token.value) return;
  loading.value = true;

  try {
    await fetchMe();
    await fetchProjectOptions();
    await fetchProjects();
    await fetchUsers();
    await fetchAudits();
    await fetchOrganizations();
    await fetchProjectExecutions();
    syncRouteAfterLogin();
    updateProjectPolling();
  } finally {
    loading.value = false;
  }
};

const handleLogin = async () => {
  loginError.value = '';
  loading.value = true;

  try {
    const data = await request('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(loginForm),
    });

    token.value = data.token;
    currentUser.value = data.user;
    localStorage.setItem('token', data.token);
    await loadDashboard();
  } catch (error) {
    loginError.value = error.message;
  } finally {
    loading.value = false;
  }
};

const handleLogout = async () => {
  try {
    if (token.value) {
      await request('/api/logout', {
        method: 'POST',
        headers: authHeaders(),
      });
    }
  } catch {
    // Ignore logout failures and clear local state.
  }

  stopProjectPolling();
  token.value = '';
  currentUser.value = null;
  projects.value = [];
  users.value = [];
  auditLogs.value = [];
  executionHistory.value = [];
  selectedProjectId.value = '';
  selectedExecutionId.value = '';
  localStorage.removeItem('token');
  resetProjectForm();
  resetUserForm();
  router.replace('/login');
};

const submitProject = async () => {
  try {
    if (isEditingProject.value) {
      await request(`/api/projects/${projectForm.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          name: projectForm.name,
          type: projectForm.type,
          nodeVersion: projectForm.nodeVersion,
          packageManager: projectForm.packageManager,
          autoBuildEnabled: projectForm.autoBuildEnabled,
          repoSshUrl: projectForm.repoSshUrl,
          watchBranch: projectForm.watchBranch,
          script: projectForm.script,
          organizationId: projectForm.organizationId,
          newOrganizationName: projectForm.newOrganizationName,
        }),
      });
      showToast('success', '项目已更新');
    } else {
      await request('/api/projects', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: projectForm.name,
          type: projectForm.type,
          nodeVersion: projectForm.nodeVersion,
          packageManager: projectForm.packageManager,
          autoBuildEnabled: projectForm.autoBuildEnabled,
          repoSshUrl: projectForm.repoSshUrl,
          watchBranch: projectForm.watchBranch,
          script: projectForm.script,
          organizationId: projectForm.organizationId,
          newOrganizationName: projectForm.newOrganizationName,
        }),
      });
      showToast('success', '项目已创建，权限已自动授予当前用户');
    }

    resetProjectForm();
    showProjectModal.value = false;
    await fetchProjects();
    await fetchProjectExecutions();
    await fetchOrganizations();
    if (isAdmin.value) {
      await fetchUsers();
      await fetchAudits();
    }
    updateProjectPolling();
  } catch (error) {
    showToast('error', error.message);
  }
};

const editProject = (project) => {
  projectForm.id = project.id;
  projectForm.name = project.name;
  projectForm.type = project.type || 'testing';
  projectForm.nodeVersion =
    project.nodeVersion || projectOptions.value.nodeVersions[0] || '20.20.1';
  projectForm.packageManager =
    project.packageManager || projectOptions.value.packageManagers[0] || 'pnpm';
  projectForm.autoBuildEnabled = Boolean(project.autoBuildEnabled);
  projectForm.repoSshUrl = project.repoSshUrl || '';
  projectForm.watchBranch = project.watchBranch || '';
  projectForm.script = project.script;
  projectForm.organizationId = project.organizationId || '';
  projectForm.newOrganizationName = '';
  mergeRepoBranches([], project.watchBranch || '');
  repoBranchError.value = '';
  showProjectModal.value = true;
};

const removeProject = async (id) => {
  const confirmed = window.confirm('删除项目后，项目权限和执行历史都会被移除。确认删除吗？');
  if (!confirmed) return;

  try {
    await request(`/api/projects/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    showToast('success', '项目已删除');
    if (projectForm.id === id) {
      resetProjectForm();
    }
    await fetchProjects();
    await fetchProjectExecutions();
    if (isAdmin.value) {
      await fetchUsers();
      await fetchAudits();
    }
    updateProjectPolling();
  } catch (error) {
    showToast('error', error.message);
  }
};

const runProject = async (project) => {
  try {
    await request(`/api/projects/${project.id}/run`, {
      method: 'POST',
      headers: authHeaders(),
    });
    selectedProjectId.value = project.id;
    showToast('success', `项目 ${project.name} 已开始执行`);
    await refreshProjectArea();
    if (isAdmin.value) {
      await fetchAudits();
    }
    updateProjectPolling();
  } catch (error) {
    showToast('error', error.message);
  }
};

const stopProject = async (project) => {
  try {
    await request(`/api/projects/${project.id}/stop`, {
      method: 'POST',
      headers: authHeaders(),
    });
    showToast('success', `已发送停止请求：${project.name}`);
    await refreshProjectArea();
    if (isAdmin.value) {
      await fetchAudits();
    }
    updateProjectPolling();
  } catch (error) {
    showToast('error', error.message);
  }
};

const openProjectHistory = async (projectId) => {
  selectedProjectId.value = projectId;
  await fetchProjectExecutions(projectId);
  isExecutionFullscreen.value = false;
  showExecutionModal.value = true;
  updateProjectPolling();
};

const editUser = (user) => {
  editingUserAccount.value = user.account;
  userForm.account = user.account;
  userForm.password = '';
  userForm.projectPermissions = [...user.projectPermissions];
  showUserModal.value = true;
};

const submitUser = async () => {
  try {
    if (isEditingUser.value) {
      await request(`/api/users/${editingUserAccount.value}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          password: userForm.password,
          projectPermissions: userForm.projectPermissions,
        }),
      });
      showToast('success', '用户已更新');
    } else {
      await request('/api/users', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          account: userForm.account,
          password: userForm.password,
          projectPermissions: userForm.projectPermissions,
        }),
      });
      showToast('success', '用户已创建');
    }

    closeUserModal();
    await fetchUsers();
    await fetchAudits();
  } catch (error) {
    showToast('error', error.message);
  }
};

const removeUser = async (account) => {
  const confirmed = window.confirm(`确认删除用户 ${account} 吗？`);
  if (!confirmed) return;

  try {
    await request(`/api/users/${account}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    showToast('success', '用户已删除');
    if (userForm.account === account) {
      resetUserForm();
    }
    await fetchUsers();
    await fetchAudits();
  } catch (error) {
    showToast('error', error.message);
  }
};

const togglePermission = (projectId) => {
  const exists = userForm.projectPermissions.includes(projectId);
  userForm.projectPermissions = exists
    ? userForm.projectPermissions.filter((id) => id !== projectId)
    : [...userForm.projectPermissions, projectId];
};

const toggleOrganizationPermission = (orgId) => {
  const orgProjectIds = projects.value
    .filter((p) => p.organizationId === orgId)
    .map((p) => p.id);
  
  const allSelected = orgProjectIds.every((id) => userForm.projectPermissions.includes(id));
  
  if (allSelected) {
    // 取消选择该组织下所有项目
    userForm.projectPermissions = userForm.projectPermissions.filter(
      (id) => !orgProjectIds.includes(id)
    );
  } else {
    // 选择该组织下所有项目
    const newPermissions = new Set([...userForm.projectPermissions, ...orgProjectIds]);
    userForm.projectPermissions = [...newPermissions];
  }
};

const isOrganizationFullySelected = (orgId) => {
  const orgProjectIds = projects.value
    .filter((p) => p.organizationId === orgId)
    .map((p) => p.id);
  return orgProjectIds.length > 0 && orgProjectIds.every((id) => userForm.projectPermissions.includes(id));
};

const isOrganizationPartiallySelected = (orgId) => {
  const orgProjectIds = projects.value
    .filter((p) => p.organizationId === orgId)
    .map((p) => p.id);
  return orgProjectIds.some((id) => userForm.projectPermissions.includes(id)) && !isOrganizationFullySelected(orgId);
};

const projectsByOrganization = computed(() => {
  const grouped = {};
  for (const org of organizations.value) {
    const orgProjects = projects.value.filter((p) => p.organizationId === org.id);
    if (orgProjects.length > 0) {
      grouped[org.id] = {
        organization: org,
        projects: orgProjects,
      };
    }
  }
  return grouped;
});

provide(dashboardKey, {
  token,
  currentUser,
  projects,
  users,
  auditLogs,
  organizations,
  executionHistory,
  selectedProjectId,
  selectedExecutionId,
  projectTypeFilter,
  organizationFilter,
  availableOrganizations,
  projectOptions,
  isAdmin,
  isEditingUser,
  isEditingProject,
  filteredProjects,
  selectedProject,
  selectedExecution,
  formatDate,
  formatPermissions,
  formatDuration,
  projectTypeLabel,
  projectTypeClass,
  statusLabel,
  progressWidth,
  organizationNameMap,
  projectsByOrganization,
  loginForm,
  projectForm,
  userForm,
  openCreateProjectModal,
  openCreateUserModal,
  editProject,
  editUser,
  removeProject,
  removeUser,
  runProject,
  stopProject,
  openProjectHistory,
  togglePermission,
  toggleOrganizationPermission,
  isOrganizationFullySelected,
  isOrganizationPartiallySelected,
});

provide(authKey, {
  token,
  loading,
  loginError,
  loginForm,
  handleLogin,
});

watch(
  () => [showProjectModal.value, projectForm.autoBuildEnabled, projectForm.repoSshUrl],
  ([isModalOpen, autoBuildEnabled, repoSshUrl]) => {
    if (repoBranchFetchTimer) {
      window.clearTimeout(repoBranchFetchTimer);
      repoBranchFetchTimer = null;
    }

    if (!isModalOpen) {
      return;
    }

    if (!autoBuildEnabled || !repoSshUrl.trim()) {
      mergeRepoBranches([], projectForm.watchBranch);
      repoBranchError.value = '';
      repoBranchLoading.value = false;
      return;
    }

    repoBranchFetchTimer = window.setTimeout(() => {
      fetchRepoBranches({ silent: true });
    }, 500);
  }
);

watch(
  () => hasRunningProject.value,
  () => {
    updateProjectPolling();
  }
);

watch(selectedProjectId, async (projectId, oldProjectId) => {
  if (projectId === oldProjectId) return;
  await fetchProjectExecutions(projectId);
});

watch(projectTypeFilter, async (env) => {
  organizationFilter.value = '';
  if (route.path !== '/projects') return;

  if (route.query.env !== env) {
    await router.replace({
      path: '/projects',
      query: { env },
    });
  }
});

watch(
  () => route.path,
  async (path) => {
    if (!token.value && path !== '/login') {
      router.replace('/login');
      return;
    }

    if (token.value && path === '/login') {
      syncRouteAfterLogin();
      return;
    }

    if (path === '/audits' && isAdmin.value) {
      await fetchAudits();
    }

    if (!isAdmin.value && (path === '/users' || path === '/audits')) {
      router.replace('/projects');
    }
  }
);

watch(
  () => route.query.env,
  (env) => {
    if (route.path !== '/projects') return;
    const nextEnv = env === 'production' ? 'production' : 'testing';
    if (projectTypeFilter.value !== nextEnv) {
      projectTypeFilter.value = nextEnv;
    }
  }
);

onMounted(async () => {
  if (!token.value) {
    if (route.path !== '/login') {
      router.replace('/login');
    }
    return;
  }

  try {
    await loadDashboard();
  } catch {
    handleLogout();
  }
});

onBeforeUnmount(() => {
  stopProjectPolling();
  if (repoBranchFetchTimer) {
    window.clearTimeout(repoBranchFetchTimer);
  }
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
});
</script>

<template>
  <div class="page-shell">
    <transition name="toast-fade">
      <div v-if="toast.visible" class="toast-message" :class="toast.type">
        {{ toast.text }}
      </div>
    </transition>

    <RouterView v-if="!token" />

    <section v-else class="dashboard">
      <header class="topbar">
        <div>
          <div class="panel-tag">Build Workspace</div>
          <h1>云打包工具</h1>
          <p class="muted">
            当前用户：<strong>{{ currentUser?.account }}</strong>
            <span v-if="isAdmin">（管理员）</span>
          </p>
        </div>

        <div class="topbar-actions">
          <button
            class="tab-btn"
            :class="{ active: route.path === '/projects' }"
            @click="router.push('/projects')"
          >
            项目列表
          </button>
          <button
            v-if="isAdmin"
            class="tab-btn"
            :class="{ active: route.path === '/users' }"
            @click="router.push('/users')"
          >
            用户管理
          </button>
          <button
            v-if="isAdmin"
            class="tab-btn"
            :class="{ active: route.path === '/audits' }"
            @click="router.push('/audits')"
          >
            操作审计
          </button>
          <button class="ghost-btn" @click="handleLogout">退出登录</button>
        </div>
      </header>

      <div v-if="loading" class="loading-card">正在加载数据...</div>
      <main v-else class="content-grid">
        <RouterView />
      </main>

      <div v-if="showProjectModal" class="modal-overlay" @click.self="closeProjectModal">
        <section class="modal-card">
          <div class="panel-head">
            <div>
              <h2>{{ isEditingProject ? '编辑项目' : '创建项目' }}</h2>
              <p class="muted">
                所有脚本都会在 `.build` 临时目录中执行。执行前会按项目要求准备 Node.js 和包管理工具。
              </p>
              <p class="muted">自动执行会由服务端调度器在 08:00-22:00 间每 3 分钟轮询一次。</p>
            </div>
            <button class="ghost-btn" @click="closeProjectModal">关闭</button>
          </div>

          <form class="stack" @submit.prevent="submitProject">
            <label>
              <span>项目名称</span>
              <input v-model.trim="projectForm.name" placeholder="例如：营销官网" />
            </label>

            <div class="organization-field">
              <label>
                <span>所属组织</span>
                <select v-model="projectForm.organizationId">
                  <option value="">选择已有组织</option>
                  <option
                    v-for="org in organizations"
                    :key="org.id"
                    :value="org.id"
                  >
                    {{ org.name }}
                  </option>
                </select>
              </label>
              <label v-if="!projectForm.organizationId">
                <span>或输入新组织</span>
                <input
                  v-model.trim="projectForm.newOrganizationName"
                  placeholder="输入新组织名称"
                />
              </label>
            </div>

            <div class="form-grid">
              <label>
                <span>类型</span>
                <select v-model="projectForm.type">
                  <option
                    v-for="type in projectOptions.projectTypes"
                    :key="type"
                    :value="type"
                  >
                    {{ projectTypeLabel(type) }}
                  </option>
                </select>
              </label>

              <label>
                <span>Node.js 版本</span>
                <select v-model="projectForm.nodeVersion">
                  <option
                    v-for="version in projectOptions.nodeVersions"
                    :key="version"
                    :value="version"
                  >
                    {{ version }}
                  </option>
                </select>
              </label>

              <label>
                <span>包管理工具</span>
                <select v-model="projectForm.packageManager">
                  <option
                    v-for="manager in projectOptions.packageManagers"
                    :key="manager"
                    :value="manager"
                  >
                    {{ manager }}
                  </option>
                </select>
              </label>
            </div>

            <label class="checkbox-card">
              <span class="checkbox-main">
                <input v-model="projectForm.autoBuildEnabled" type="checkbox" />
                <span>
                  <strong>开启自动执行</strong>
                  <span class="field-hint">
                    开启后将按仓库 SSH 地址和监听分支进行轮询，检测到新 commit 自动执行脚本。
                  </span>
                </span>
              </span>
            </label>

            <div v-if="projectForm.autoBuildEnabled" class="stack auto-build-config">
              <label>
                <span>仓库 SSH 地址</span>
                <input
                  v-model.trim="projectForm.repoSshUrl"
                  placeholder="例如：git@gitee.com:team/app.git"
                />
              </label>

              <div class="form-grid form-grid-auto">
                <label>
                  <span>监听分支</span>
                  <select v-model="projectForm.watchBranch" :disabled="repoBranchLoading">
                    <option value="" disabled>
                      {{ repoBranchLoading ? '正在拉取分支...' : '请选择监听分支' }}
                    </option>
                    <option
                      v-for="branch in repoBranches"
                      :key="branch"
                      :value="branch"
                    >
                      {{ branch }}
                    </option>
                  </select>
                </label>

                <div class="inline-field-actions">
                  <span>远端分支</span>
                  <button
                    type="button"
                    class="ghost-btn"
                    :disabled="repoBranchLoading || !projectForm.repoSshUrl.trim()"
                    @click="fetchRepoBranches()"
                  >
                    {{ repoBranchLoading ? '拉取中...' : '拉取分支' }}
                  </button>
                </div>
              </div>

              <div class="helper-row">
                <span v-if="repoBranchError" class="error-text">{{ repoBranchError }}</span>
                <span v-else class="muted">
                  只会轮询开启自动执行的项目，其他时间段不会扫仓库。
                </span>
              </div>
            </div>

            <label>
              <span>脚本</span>
              <textarea
                v-model.trim="projectForm.script"
                rows="8"
                placeholder="例如：git clone xxx && cd repo && sh deploy.sh"
              />
            </label>

            <button class="primary-btn">
              {{ isEditingProject ? '保存项目' : '创建项目' }}
            </button>
          </form>
        </section>
      </div>

      <div v-if="showUserModal" class="modal-overlay" @click.self="closeUserModal">
        <section class="modal-card">
          <div class="panel-head">
            <div>
              <h2>{{ isEditingUser ? '编辑用户' : '创建用户' }}</h2>
              <p class="muted">字段：账户、密码、项目权限</p>
            </div>
            <button class="ghost-btn" @click="closeUserModal">关闭</button>
          </div>

          <form class="stack" @submit.prevent="submitUser">
            <label>
              <span>账户</span>
              <input
                v-model.trim="userForm.account"
                :disabled="isEditingUser"
                placeholder="例如：zhangsan"
              />
            </label>

            <label>
              <span>密码</span>
              <input
                v-model="userForm.password"
                type="password"
                :placeholder="isEditingUser ? '留空则保持原密码' : '请输入密码'"
              />
            </label>

            <div class="stack">
              <span>项目权限</span>
              <div class="permission-tree">
                <div
                  v-for="orgData in projectsByOrganization"
                  :key="orgData.organization.id"
                  class="permission-org"
                >
                  <label class="permission-org-header">
                    <input
                      type="checkbox"
                      :checked="isOrganizationFullySelected(orgData.organization.id)"
                      :indeterminate="isOrganizationPartiallySelected(orgData.organization.id)"
                      @change="toggleOrganizationPermission(orgData.organization.id)"
                    />
                    <span class="org-name">{{ orgData.organization.name }}</span>
                    <span class="org-count">({{ orgData.projects.length }}个项目)</span>
                  </label>
                  <div class="permission-projects">
                    <label
                      v-for="project in orgData.projects"
                      :key="project.id"
                      class="permission-item"
                    >
                      <input
                        type="checkbox"
                        :checked="userForm.projectPermissions.includes(project.id)"
                        @change="togglePermission(project.id)"
                      />
                      <span>{{ project.name }}</span>
                    </label>
                  </div>
                </div>
                <div v-if="Object.keys(projectsByOrganization).length === 0" class="permission-empty">
                  暂无可分配的项目
                </div>
              </div>
            </div>

            <button class="primary-btn">
              {{ isEditingUser ? '保存用户' : '创建用户' }}
            </button>
          </form>
        </section>
      </div>

      <div
        v-if="showExecutionModal"
        class="modal-overlay"
        @click.self="
          showExecutionModal = false;
          isExecutionFullscreen = false;
        "
      >
        <section
          class="modal-card modal-card-wide"
          :class="{ 'modal-card-fullscreen': isExecutionFullscreen }"
        >
          <div class="panel-head">
            <div>
              <h2>执行详情</h2>
              <p class="muted">
                {{
                  selectedProject
                    ? `当前项目：${selectedProject.name}`
                    : '从列表中选择项目查看执行状态和历史日志'
                }}
              </p>
            </div>
            <div class="topbar-actions">
              <button class="ghost-btn" @click="isExecutionFullscreen = !isExecutionFullscreen">
                {{ isExecutionFullscreen ? '缩小' : '全屏' }}
              </button>
              <button
                class="ghost-btn"
                @click="
                  showExecutionModal = false;
                  isExecutionFullscreen = false;
                "
              >
                关闭
              </button>
            </div>
          </div>

          <template v-if="selectedProject">
            <div class="execution-summary">
              <div class="summary-row">
                <span class="summary-label">当前状态</span>
                <div class="summary-actions">
                  <span
                    class="status-pill"
                    :class="selectedExecution?.status || (selectedProject.isRunning ? 'running' : 'idle')"
                  >
                    {{
                      statusLabel(
                        selectedExecution?.status ||
                          (selectedProject.isRunning ? 'running' : 'idle')
                      )
                    }}
                  </span>
                  <button
                    v-if="selectedProject.isRunning"
                    class="mini-btn warn"
                    @click="stopProject(selectedProject)"
                  >
                    停止执行
                  </button>
                </div>
              </div>

              <div class="progress-track">
                <div
                  class="progress-bar"
                  :class="selectedExecution?.status || (selectedProject.isRunning ? 'running' : 'idle')"
                  :style="{
                    width: progressWidth(
                      selectedExecution?.status ||
                        (selectedProject.isRunning ? 'running' : 'idle')
                    ),
                  }"
                />
              </div>

              <div class="summary-grid">
                <div>
                  <span class="summary-label">开始时间</span>
                  <strong>{{ formatDate(selectedExecution?.startedAt) }}</strong>
                </div>
                <div>
                  <span class="summary-label">结束时间</span>
                  <strong>{{ formatDate(selectedExecution?.endedAt) }}</strong>
                </div>
                <div>
                  <span class="summary-label">执行人</span>
                  <strong>{{ selectedExecution?.operatorAccount || '-' }}</strong>
                </div>
                <div>
                  <span class="summary-label">退出码</span>
                  <strong>{{ selectedExecution?.exitCode ?? '-' }}</strong>
                </div>
                <div>
                  <span class="summary-label">耗时</span>
                  <strong>{{ formatDuration(selectedExecution?.durationMs) }}</strong>
                </div>
                <div>
                  <span class="summary-label">最后一段错误</span>
                  <strong>{{ selectedExecution?.lastErrorExcerpt || '-' }}</strong>
                </div>
              </div>
            </div>

            <div class="execution-modal-grid">
              <div class="history-list">
                <button
                  v-for="execution in executionHistory"
                  :key="execution.id"
                  class="history-item"
                  :class="{ active: selectedExecutionId === execution.id }"
                  @click="selectedExecutionId = execution.id"
                >
                  <div class="history-main">
                    <span class="status-pill" :class="execution.status">
                      {{ statusLabel(execution.status) }}
                    </span>
                    <strong>{{ formatDate(execution.startedAt) }}</strong>
                  </div>
                  <div class="cell-subtext">
                    {{ execution.operatorAccount }} · 退出码 {{ execution.exitCode ?? '-' }}
                  </div>
                </button>

                <div v-if="executionHistory.length === 0" class="empty-history">
                  暂无执行记录
                </div>
              </div>

              <div class="terminal">
                <div class="terminal-head">执行日志</div>
                <pre class="terminal-body">{{ selectedExecution?.log || '暂无日志' }}</pre>
              </div>
            </div>
          </template>
        </section>
      </div>
    </section>
  </div>
</template>

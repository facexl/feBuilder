import cors from 'cors';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { readJson, writeJson } from './json-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const usersFile = path.join(rootDir, 'data', 'users.json');
const projectsFile = path.join(rootDir, 'data', 'projects.json');
const executionsFile = path.join(rootDir, 'data', 'executions.json');
const auditLogsFile = path.join(rootDir, 'data', 'audit-logs.json');
const sessionsFile = path.join(rootDir, 'data', 'sessions.json');
const organizationsFile = path.join(rootDir, 'data', 'organizations.json');
const buildRootDir = path.join(rootDir, '.build');
const NODE_VERSION_OPTIONS = ['16.16.0', '18.16.0', '22.22.0', '24.14.0', '20.20.1'];
const PROJECT_TYPES = ['production', 'testing'];
const PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn'];
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EXECUTION_HISTORY_LIMIT = 10;
const MAX_CONCURRENT_EXECUTIONS = 5;
const AUTO_BUILD_SCAN_HEARTBEAT_MS = 3 * 60 * 1000;
const AUTO_BUILD_SCAN_WINDOW_START_MINUTE = 8 * 60;
const AUTO_BUILD_SCAN_WINDOW_END_MINUTE = 22 * 60;

const app = express();
const port = 3001;
const sessions = new Map();
const runningExecutions = new Map();
const projectErrorCounts = new Map(); // 项目连续错误计数
let autoBuildSchedulerTimer = null;
let autoBuildScanInProgress = false;
let lastAutoBuildScanSlot = '';

app.use(cors());
app.use(express.json());

const sanitizeUser = (user) => ({
  account: user.account,
  projectPermissions: user.projectPermissions || [],
  isAdmin: user.account === 'admin',
});

const getUsers = async () =>
  readJson(usersFile, [
    {
      account: 'admin',
      password: 'admin123',
      projectPermissions: [],
    },
  ]);

const saveUsers = async (users) => {
  await writeJson(usersFile, users);
};

const getProjects = async () => readJson(projectsFile, []);

const saveProjects = async (projects) => {
  await writeJson(projectsFile, projects);
};

const getExecutions = async () => readJson(executionsFile, []);

const saveExecutions = async (executions) => {
  await writeJson(executionsFile, executions);
};

const getAuditLogs = async () => readJson(auditLogsFile, []);

const saveAuditLogs = async (auditLogs) => {
  await writeJson(auditLogsFile, auditLogs);
};

const getSessions = async () => readJson(sessionsFile, []);

const saveSessions = async (sessionList) => {
  await writeJson(sessionsFile, sessionList);
};

const getOrganizations = async () => readJson(organizationsFile, []);

const saveOrganizations = async (organizations) => {
  await writeJson(organizationsFile, organizations);
};

const cleanupUnusedOrganizations = async () => {
  const projects = await getProjects();
  const organizations = await getOrganizations();
  
  // 获取所有被引用的组织ID
  const usedOrgIds = new Set(
    projects.map((p) => p.organizationId).filter(Boolean)
  );
  
  // 过滤出被引用的组织
  const usedOrganizations = organizations.filter((org) => usedOrgIds.has(org.id));
  
  // 如果有组织被删除，则保存
  if (usedOrganizations.length !== organizations.length) {
    await saveOrganizations(usedOrganizations);
  }
  
  return usedOrganizations;
};

const sanitizeName = (value) =>
  String(value || 'project')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'project';

const buildTempDirName = (project) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${project.id}_${sanitizeName(project.name)}_${timestamp}`;
};

const normalizeProject = (project) => ({
  ...project,
  type: PROJECT_TYPES.includes(project.type) ? project.type : 'testing',
  nodeVersion: NODE_VERSION_OPTIONS.includes(project.nodeVersion)
    ? project.nodeVersion
    : NODE_VERSION_OPTIONS[0],
  packageManager: PACKAGE_MANAGERS.includes(project.packageManager)
    ? project.packageManager
    : 'pnpm',
  autoBuildEnabled: Boolean(project.autoBuildEnabled),
  repoSshUrl: String(project.repoSshUrl || '').trim(),
  watchBranch: String(project.watchBranch || '').trim(),
  lastSeenCommit: String(project.lastSeenCommit || '').trim(),
  lastTriggeredCommit: String(project.lastTriggeredCommit || '').trim(),
  lastPolledAt: project.lastPolledAt || null,
  organizationId: project.organizationId || '',
});

const createExecutionRecord = ({ project, operatorAccount, tempDirName }) => ({
  id: `exec_${Date.now()}_${randomUUID().slice(0, 8)}`,
  projectId: project.id,
  projectName: project.name,
  operatorAccount,
  scriptSnapshot: project.script,
  status: 'running',
  startedAt: new Date().toISOString(),
  endedAt: null,
  durationMs: null,
  exitCode: null,
  tempDirName,
  log: '',
  lastErrorExcerpt: '',
  stopRequested: false,
});

const sortExecutionsDesc = (items) =>
  [...items].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

const getProjectLatestExecution = (projectId, executions) => {
  const runtime = runningExecutions.get(projectId);
  if (runtime) {
    return runtime.execution;
  }

  return sortExecutionsDesc(
    executions.filter((item) => item.projectId === projectId)
  )[0] || null;
};

const mergeProjectRuntime = async (project) => {
  const normalizedProject = normalizeProject(project);
  const executions = await getExecutions();
  const latestExecution = getProjectLatestExecution(normalizedProject.id, executions);

  return {
    ...normalizedProject,
    isRunning: latestExecution?.status === 'running',
    latestExecution: latestExecution
      ? {
          id: latestExecution.id,
          status: latestExecution.status,
          startedAt: latestExecution.startedAt,
          endedAt: latestExecution.endedAt,
          durationMs: latestExecution.durationMs,
          exitCode: latestExecution.exitCode,
          operatorAccount: latestExecution.operatorAccount,
          lastErrorExcerpt: latestExecution.lastErrorExcerpt || '',
        }
      : null,
  };
};

const appendProjectPermission = (user, projectId) => {
  const permissions = new Set(user.projectPermissions || []);
  permissions.add(projectId);
  user.projectPermissions = [...permissions];
};

const loadSessionsIntoMemory = async () => {
  const sessionList = await getSessions();
  const now = Date.now();
  const validSessions = sessionList.filter((session) => {
    const expiresAt = new Date(session.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt > now;
  });

  sessions.clear();
  validSessions.forEach((session) => {
    sessions.set(session.token, session);
  });

  if (validSessions.length !== sessionList.length) {
    await saveSessions(validSessions);
  }
};

const persistSessions = async () => {
  await saveSessions([...sessions.values()]);
};

const createSession = async (account) => {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const session = {
    token: randomUUID(),
    account,
    createdAt,
    expiresAt,
  };

  sessions.set(session.token, session);
  await persistSessions();
  return session;
};

const removeSession = async (token) => {
  sessions.delete(token);
  await persistSessions();
};

const isSessionExpired = (session) => {
  const expiresAt = new Date(session.expiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
};

const authMiddleware = async (req, res, next) => {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : null;

  if (!token || !sessions.has(token)) {
    return res.status(401).json({ message: '未登录或登录已失效' });
  }

  const session = sessions.get(token);
  if (isSessionExpired(session)) {
    await removeSession(token);
    return res.status(401).json({ message: '登录已过期，请重新登录' });
  }

  const users = await getUsers();
  const user = users.find((item) => item.account === session.account);

  if (!user) {
    await removeSession(token);
    return res.status(401).json({ message: '用户不存在' });
  }

  req.user = user;
  req.token = token;
  next();
};

const adminOnly = (req, res, next) => {
  if (req.user.account !== 'admin') {
    return res.status(403).json({ message: '只有 admin 可以访问该功能' });
  }
  next();
};

const canAccessProject = (user, projectId) => {
  if (user.account === 'admin') {
    return true;
  }

  return (user.projectPermissions || []).includes(projectId);
};

const getVisibleProjectsForUser = async (user) => {
  const projects = await getProjects();

  if (user.account === 'admin') {
    return Promise.all(projects.map(mergeProjectRuntime));
  }

  const allowedIds = new Set(user.projectPermissions || []);
  const visibleProjects = projects.filter((project) => allowedIds.has(project.id));
  return Promise.all(visibleProjects.map(mergeProjectRuntime));
};

const getProjectById = async (projectId) => {
  const projects = await getProjects();
  const project = projects.find((item) => item.id === projectId);
  return project ? normalizeProject(project) : null;
};

const getProjectExecutionsForUser = async (user, projectId) => {
  const project = await getProjectById(projectId);
  if (!project) {
    return undefined;
  }

  if (!canAccessProject(user, projectId)) {
    return null;
  }

  const executions = await getExecutions();
  const history = executions.filter((item) => item.projectId === projectId);
  const runtime = runningExecutions.get(projectId);
  const running = runtime?.execution;

  const merged = running
    ? [running, ...history.filter((item) => item.id !== running.id)]
    : history;

  return sortExecutionsDesc(merged);
};

const appendExecutionLog = (execution, chunk) => {
  execution.log += chunk;
};

const updateExecutionSummary = (execution) => {
  if (execution.startedAt && execution.endedAt) {
    execution.durationMs =
      new Date(execution.endedAt).getTime() - new Date(execution.startedAt).getTime();
  }

  const stderrBlocks = execution.log
    .split(/\[\d{4}-\d{2}-\d{2}T.*?\] stderr\n/g)
    .slice(1)
    .map((block) => block.split(/\n\[\d{4}-\d{2}-\d{2}T/)[0].trim())
    .filter(Boolean);

  execution.lastErrorExcerpt =
    execution.status === 'error' ? stderrBlocks.at(-1) || '' : '';
};

const createAuditLog = async ({ actorAccount, action, targetType, targetId, detail }) => {
  const auditLogs = await getAuditLogs();
  auditLogs.unshift({
    id: `audit_${Date.now()}_${randomUUID().slice(0, 8)}`,
    actorAccount,
    action,
    targetType,
    targetId,
    detail,
    createdAt: new Date().toISOString(),
  });
  await saveAuditLogs(auditLogs.slice(0, 500));
};

const runCommand = (command, args, { cwd, timeoutMs = 20000 } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`${command} 执行超时`));
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += String(data);
    });

    child.stderr.on('data', (data) => {
      stderr += String(data);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} 执行失败，退出码：${code}`));
        return;
      }

      resolve({
        stdout,
        stderr,
      });
    });
  });

const parseGitBranchName = (line) => {
  const ref = line.trim().split(/\s+/)[1] || '';
  return ref.replace(/^refs\/heads\//, '');
};

const listRemoteBranches = async (repoSshUrl) => {
  const { stdout } = await runCommand('git', ['ls-remote', '--heads', repoSshUrl], {
    timeoutMs: 20000,
  });

  return stdout
    .split('\n')
    .map(parseGitBranchName)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
};

const getRemoteBranchCommit = async (repoSshUrl, branch) => {
  const { stdout } = await runCommand(
    'git',
    ['ls-remote', repoSshUrl, `refs/heads/${branch}`],
    {
      timeoutMs: 20000,
    }
  );

  const line = stdout
    .split('\n')
    .map((item) => item.trim())
    .find(Boolean);

  return line ? line.split(/\s+/)[0] || '' : '';
};

const getAutoBuildScanSlot = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
};

const shouldRunAutoBuildScan = (date = new Date()) => {
  const currentMinute = date.getHours() * 60 + date.getMinutes();

  return (
    currentMinute >= AUTO_BUILD_SCAN_WINDOW_START_MINUTE &&
    currentMinute <= AUTO_BUILD_SCAN_WINDOW_END_MINUTE
  );
};

const startProjectExecution = async ({
  project,
  operatorAccount,
  auditAction,
  auditDetail,
}) => {
  const execution = await executeProjectScript(project, { account: operatorAccount });
  await createAuditLog({
    actorAccount: operatorAccount,
    action: auditAction,
    targetType: 'project',
    targetId: project.id,
    detail: auditDetail,
  });
  return execution;
};

const isWindows = process.platform === 'win32';

const buildEnvironmentBootstrapScript = (project) => {
  if (isWindows) {
    const lines = ['@echo off'];
    const appendCheckedCommand = (command) => {
      lines.push(command, 'if errorlevel 1 exit /b %errorlevel%');
    };

    appendCheckedCommand(`nvm install ${project.nodeVersion}`);
    appendCheckedCommand(`nvm use ${project.nodeVersion}`);
    appendCheckedCommand('node -v');
    appendCheckedCommand('call npm -v');

    if (project.packageManager === 'pnpm') {
      lines.push('where pnpm >nul 2>nul');
      lines.push('if errorlevel 1 call npm install -g pnpm');
      lines.push('if errorlevel 1 exit /b %errorlevel%');
      appendCheckedCommand('call pnpm -v');
    }

    if (project.packageManager === 'yarn') {
      lines.push('where yarn >nul 2>nul');
      lines.push('if errorlevel 1 call npm install -g yarn');
      lines.push('if errorlevel 1 exit /b %errorlevel%');
      appendCheckedCommand('call yarn -v');
    }

    if (project.packageManager === 'npm') {
      appendCheckedCommand('call npm -v');
    }

    lines.push(project.script);
    return lines.join('\r\n');
  }

  // Linux/Mac: 使用 nvm
  const lines = [
    'set -e',
    'export NVM_DIR="$HOME/.nvm"',
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
    `nvm install ${project.nodeVersion}`,
    `nvm use ${project.nodeVersion}`,
    'node -v',
    'npm -v',
  ];

  if (project.packageManager === 'pnpm') {
    lines.push(
      'command -v pnpm >/dev/null 2>&1 || npm install -g pnpm',
      'pnpm -v'
    );
  }

  if (project.packageManager === 'yarn') {
    lines.push(
      'command -v yarn >/dev/null 2>&1 || npm install -g yarn',
      'yarn -v'
    );
  }

  if (project.packageManager === 'npm') {
    lines.push('npm -v');
  }

  lines.push(project.script);
  return lines.join('\n');
};

const getBootstrapFileName = () => (isWindows ? 'bootstrap.cmd' : 'bootstrap.sh');

const getBootstrapSpawnOptions = (bootstrapFilePath, cwd) =>
  isWindows
    ? {
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', bootstrapFilePath],
        options: {
          cwd,
          env: process.env,
          windowsHide: true,
        },
      }
    : {
        command: 'sh',
        args: [bootstrapFilePath],
        options: {
          cwd,
          env: process.env,
        },
      };

const finalizeExecution = async (execution) => {
  const executions = await getExecutions();
  updateExecutionSummary(execution);
  const nextExecutions = executions.filter((item) => item.id !== execution.id);
  nextExecutions.unshift({ ...execution });
  const limitedExecutions = [];
  const projectCounters = new Map();

  for (const item of nextExecutions) {
    const count = projectCounters.get(item.projectId) || 0;
    if (count >= EXECUTION_HISTORY_LIMIT) {
      continue;
    }

    projectCounters.set(item.projectId, count + 1);
    limitedExecutions.push(item);
  }
  await saveExecutions(limitedExecutions);
};

const scanAutoBuildProjects = async () => {
  const now = new Date();
  if (!shouldRunAutoBuildScan(now)) {
    return;
  }

  const slot = getAutoBuildScanSlot(now);
  const scanTime = now.toISOString();
  if (lastAutoBuildScanSlot === slot || autoBuildScanInProgress) {
    return;
  }

  autoBuildScanInProgress = true;
  lastAutoBuildScanSlot = slot;

  try {
    const projects = await getProjects();
    let hasProjectChange = false;

    for (const project of projects) {
      const normalizedProject = normalizeProject(project);
      if (
        !normalizedProject.autoBuildEnabled ||
        !normalizedProject.repoSshUrl ||
        !normalizedProject.watchBranch
      ) {
        continue;
      }

      try {
        const commitId = await getRemoteBranchCommit(
          normalizedProject.repoSshUrl,
          normalizedProject.watchBranch
        );

        // 成功获取提交，重置错误计数
        projectErrorCounts.delete(project.id);

        if (project.lastSeenCommit !== commitId || project.lastPolledAt !== scanTime) {
          project.lastSeenCommit = commitId;
          project.lastPolledAt = scanTime;
          hasProjectChange = true;
        }

        if (!commitId || project.lastTriggeredCommit === commitId) {
          continue;
        }

        if (runningExecutions.has(project.id)) {
          continue;
        }

        if (runningExecutions.size >= MAX_CONCURRENT_EXECUTIONS) {
          console.warn(
            `[auto-build] skipped ${project.id} because execution capacity is full`
          );
          continue;
        }

        try {
          await startProjectExecution({
            project: normalizedProject,
            operatorAccount: 'system',
            auditAction: 'execution_auto_start',
            auditDetail: `轮询检测到 ${normalizedProject.watchBranch} 分支新提交 ${commitId.slice(0, 10)}，自动执行项目 ${normalizedProject.name}`,
          });
          // 只有执行成功启动后才更新 lastTriggeredCommit
          project.lastTriggeredCommit = commitId;
          hasProjectChange = true;
        } catch (executionError) {
          // 执行启动失败，不更新 lastTriggeredCommit，下次扫描会重试
          console.error(
            `[auto-build] failed to start execution for ${project.id}:`,
            executionError.stack || executionError.message
          );
        }
      } catch (error) {
        // 增加错误计数
        const errorCount = (projectErrorCounts.get(project.id) || 0) + 1;
        projectErrorCounts.set(project.id, errorCount);
        
        // 根据错误次数决定是否更新 lastPolledAt
        // 连续错误次数越多，更新频率越低（简单的 backoff 策略）
        const shouldUpdatePolledAt = errorCount <= 3 || errorCount % 5 === 0;
        if (shouldUpdatePolledAt) {
          project.lastPolledAt = scanTime;
          hasProjectChange = true;
        }
        
        console.error(
          `[auto-build] scan failed for ${project.id} (attempt ${errorCount}):`,
          error.stack || error.message
        );
      }
    }

    if (hasProjectChange) {
      await saveProjects(projects);
    }
  } finally {
    autoBuildScanInProgress = false;
  }
};

const startAutoBuildScheduler = () => {
  if (autoBuildSchedulerTimer) {
    return;
  }

  autoBuildSchedulerTimer = setInterval(() => {
    scanAutoBuildProjects().catch((error) => {
      console.error('[auto-build] scheduler tick failed:', error);
    });
  }, AUTO_BUILD_SCAN_HEARTBEAT_MS);

  scanAutoBuildProjects().catch((error) => {
    console.error('[auto-build] initial scan failed:', error);
  });
};

const stopAutoBuildScheduler = () => {
  if (autoBuildSchedulerTimer) {
    clearInterval(autoBuildSchedulerTimer);
    autoBuildSchedulerTimer = null;
    console.log('[auto-build] scheduler stopped');
  }
};

const stopAllRunningExecutions = async () => {
  const projectIds = [...runningExecutions.keys()];
  if (projectIds.length === 0) {
    return;
  }
  
  console.log(`[shutdown] stopping ${projectIds.length} running executions...`);
  
  for (const projectId of projectIds) {
    const runtime = runningExecutions.get(projectId);
    if (runtime?.child) {
      runtime.execution.stopRequested = true;
      appendExecutionLog(
        runtime.execution,
        `[${new Date().toISOString()}] 服务器关闭，终止执行进程\n`
      );
      try {
        runtime.child.kill('SIGTERM');
      } catch (error) {
        console.error(`[shutdown] failed to send SIGTERM to ${projectId}:`, error.message);
      }
      setTimeout(() => {
        try {
          if (runningExecutions.has(projectId)) {
            runtime.child.kill('SIGKILL');
          }
        } catch (error) {
          // 进程可能已经退出，忽略错误
        }
      }, 3000);
    }
  }
  // 等待所有执行完成或超时
  const timeout = 10000;
  const startTime = Date.now();
  while (runningExecutions.size > 0 && Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (runningExecutions.size > 0) {
    console.warn(`[shutdown] ${runningExecutions.size} executions still running after timeout`);
  } else {
    console.log('[shutdown] all executions stopped');
  }
};

const executeProjectScript = async (project, user) => {
  const tempDirName = buildTempDirName(project);
  const tempDir = path.join(buildRootDir, tempDirName);
  const execution = createExecutionRecord({
    project,
    operatorAccount: user.account,
    tempDirName,
  });

  const runtime = {
    execution,
    child: null,
  };
  runningExecutions.set(project.id, runtime);

  await fs.mkdir(tempDir, { recursive: true });
  appendExecutionLog(
    execution,
    `[${new Date().toISOString()}] 准备执行脚本\n临时目录：${tempDir}\n项目类型：${project.type}\nNode.js：${project.nodeVersion}\n包管理工具：${project.packageManager}\n操作系统：${isWindows ? 'Windows' : 'Unix'}\n\n`
  );

  const script = buildEnvironmentBootstrapScript(project);
  const bootstrapFilePath = path.join(tempDir, getBootstrapFileName());
  
  appendExecutionLog(
    execution,
    `执行脚本文件：${bootstrapFilePath}\n执行脚本内容:\n${script}\n\n`
  );

  await fs.writeFile(bootstrapFilePath, script, 'utf8');

  // 在后台执行脚本，不等待完成
  const execPromise = new Promise((resolve, reject) => {
    const { command, args, options } = getBootstrapSpawnOptions(
      bootstrapFilePath,
      tempDir
    );
    const child = spawn(command, args, options);

    runtime.child = child;

    child.stdout.on('data', (data) => {
      appendExecutionLog(
        execution,
        `[${new Date().toISOString()}] stdout\n${data}`
      );
    });

    child.stderr.on('data', (data) => {
      appendExecutionLog(
        execution,
        `[${new Date().toISOString()}] stderr\n${data}`
      );
    });

    child.on('close', (code) => {
      resolve({ exitCode: code });
    });

    child.on('error', (error) => {
      reject(error);
    });
  });

  // 异步处理执行结果，不阻塞返回
  execPromise.then(async (result) => {
    execution.status = execution.stopRequested
      ? 'stopped'
      : result.exitCode === 0
        ? 'success'
        : 'error';
    execution.endedAt = new Date().toISOString();
    execution.exitCode = result.exitCode;
    appendExecutionLog(
      execution,
      `\n[${execution.endedAt}] 脚本执行结束，退出码：${result.exitCode}\n`
    );
  }).catch(async (error) => {
    execution.status = 'error';
    execution.endedAt = new Date().toISOString();
    execution.exitCode = -1;
    appendExecutionLog(
      execution,
      `\n[${execution.endedAt}] 执行失败\n${error.message}\n`
    );
  }).finally(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      appendExecutionLog(
        execution,
        `[${new Date().toISOString()}] 临时目录已清理：${tempDir}\n`
      );
    } catch (error) {
      appendExecutionLog(
        execution,
        `[${new Date().toISOString()}] 清理临时目录失败\n${error.message}\n`
      );
    } finally {
      runningExecutions.delete(project.id);
      await finalizeExecution(execution);
      await createAuditLog({
        actorAccount: user.account,
        action: execution.status === 'success' ? 'execution_success' : execution.status === 'stopped' ? 'execution_stop' : 'execution_error',
        targetType: 'project',
        targetId: project.id,
        detail: `${project.name} 执行结束，状态：${execution.status}，退出码：${execution.exitCode}`,
      });
    }
  });

  // 立即返回执行记录，不等待脚本执行完成
  return execution;
};

const stopProjectExecution = async (projectId, operatorAccount) => {
  const runtime = runningExecutions.get(projectId);
  if (!runtime) {
    return false;
  }

  runtime.execution.stopRequested = true;
  appendExecutionLog(
    runtime.execution,
    `[${new Date().toISOString()}] 收到手动停止请求，准备终止执行进程\n`
  );

  runtime.child.kill('SIGTERM');
  setTimeout(() => {
    if (runningExecutions.has(projectId)) {
      runtime.child.kill('SIGKILL');
    }
  }, 5000);

  await createAuditLog({
    actorAccount: operatorAccount,
    action: 'execution_stop',
    targetType: 'project',
    targetId: projectId,
    detail: `手动停止项目执行`,
  });
  return true;
};

app.post('/api/login', async (req, res) => {
  const { account, password } = req.body || {};
  const users = await getUsers();
  const user = users.find(
    (item) => item.account === account && item.password === password
  );

  if (!user) {
    return res.status(401).json({ message: '账号或密码错误' });
  }

  const session = await createSession(user.account);
  await createAuditLog({
    actorAccount: user.account,
    action: 'login',
    targetType: 'session',
    targetId: session.token,
    detail: '用户登录',
  });

  res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: sanitizeUser(user),
  });
});

app.get('/api/me', authMiddleware, async (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.post('/api/logout', authMiddleware, async (req, res) => {
  await createAuditLog({
    actorAccount: req.user.account,
    action: 'logout',
    targetType: 'session',
    targetId: req.token,
    detail: '用户退出登录',
  });
  await removeSession(req.token);
  res.json({ success: true });
});

app.get('/api/projects', authMiddleware, async (req, res) => {
  const projects = await getVisibleProjectsForUser(req.user);
  res.json(projects);
});

app.post('/api/projects', authMiddleware, async (req, res) => {
  const {
    name,
    script,
    type,
    nodeVersion,
    packageManager,
    autoBuildEnabled,
    repoSshUrl,
    watchBranch,
    organizationId,
    newOrganizationName,
  } = req.body || {};
  const normalizedRepoSshUrl = String(repoSshUrl || '').trim();
  const normalizedWatchBranch = String(watchBranch || '').trim();
  const normalizedAutoBuildEnabled = Boolean(autoBuildEnabled);

  if (!name || !script) {
    return res.status(400).json({ message: '项目名称和脚本不能为空' });
  }

  if (!PROJECT_TYPES.includes(type)) {
    return res.status(400).json({ message: '项目类型不合法' });
  }

  if (!NODE_VERSION_OPTIONS.includes(nodeVersion)) {
    return res.status(400).json({ message: 'Node.js 版本不合法' });
  }

  if (!PACKAGE_MANAGERS.includes(packageManager)) {
    return res.status(400).json({ message: '包管理工具不合法' });
  }

  if (normalizedAutoBuildEnabled && (!normalizedRepoSshUrl || !normalizedWatchBranch)) {
    return res.status(400).json({ message: '开启自动执行后，仓库地址和监听分支不能为空' });
  }

  // 处理组织
  let finalOrganizationId = '';
  const organizations = await getOrganizations();
  
  if (newOrganizationName && newOrganizationName.trim()) {
    const normalizedName = newOrganizationName.trim();
    const existingOrg = organizations.find(
      (org) => org.name.toLowerCase() === normalizedName.toLowerCase()
    );
    
    if (existingOrg) {
      return res.status(400).json({ message: `已存在「${existingOrg.name}」组织，请选择已有组织` });
    }
    
    const newOrg = {
      id: `org_${Date.now()}`,
      name: normalizedName,
      createdAt: new Date().toISOString(),
    };
    organizations.push(newOrg);
    await saveOrganizations(organizations);
    finalOrganizationId = newOrg.id;
  } else if (organizationId) {
    const org = organizations.find((o) => o.id === organizationId);
    if (!org) {
      return res.status(400).json({ message: '选择的组织不存在' });
    }
    finalOrganizationId = organizationId;
  } else {
    return res.status(400).json({ message: '请选择或创建一个组织' });
  }

  const now = new Date().toISOString();
  const projects = await getProjects();
  const project = {
    id: `proj_${Date.now()}`,
    name,
    script,
    type,
    nodeVersion,
    packageManager,
    autoBuildEnabled: normalizedAutoBuildEnabled,
    repoSshUrl: normalizedRepoSshUrl,
    watchBranch: normalizedWatchBranch,
    lastSeenCommit: '',
    lastTriggeredCommit: '',
    lastPolledAt: null,
    organizationId: finalOrganizationId,
    createdAt: now,
    updatedAt: now,
  };

  projects.unshift(project);
  const users = await getUsers();
  const creator = users.find((user) => user.account === req.user.account);

  if (creator) {
    appendProjectPermission(creator, project.id);
  }

  await saveProjects(projects);
  await saveUsers(users);
  await createAuditLog({
    actorAccount: req.user.account,
    action: 'project_create',
    targetType: 'project',
    targetId: project.id,
    detail: `创建项目 ${project.name}`,
  });
  await cleanupUnusedOrganizations();

  res.status(201).json(normalizeProject(project));
});

app.post('/api/projects/:id/run', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const project = await getProjectById(id);

  if (!project) {
    return res.status(404).json({ message: '项目不存在' });
  }

  if (!canAccessProject(req.user, id)) {
    return res.status(403).json({ message: '你没有该项目的操作权限' });
  }

  if (runningExecutions.has(id)) {
    return res.status(409).json({ message: '该项目正在执行中，请勿重复点击' });
  }

  if (runningExecutions.size >= MAX_CONCURRENT_EXECUTIONS) {
    return res
      .status(429)
      .json({ message: '当前服务已满，请等待其他任务完成' });
  }

  const execution = await startProjectExecution({
    project,
    operatorAccount: req.user.account,
    auditAction: 'execution_start',
    auditDetail: `开始执行项目 ${project.name}`,
  });
  res.status(202).json({
    id: execution.id,
    status: execution.status,
    startedAt: execution.startedAt,
  });
});

app.post('/api/projects/:id/stop', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const project = await getProjectById(id);

  if (!project) {
    return res.status(404).json({ message: '项目不存在' });
  }

  if (!canAccessProject(req.user, id)) {
    return res.status(403).json({ message: '你没有该项目的操作权限' });
  }

  if (!runningExecutions.has(id)) {
    return res.status(409).json({ message: '该项目当前没有执行中的任务' });
  }

  await stopProjectExecution(id, req.user.account);
  res.json({ success: true });
});

app.put('/api/projects/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const {
    name,
    script,
    type,
    nodeVersion,
    packageManager,
    autoBuildEnabled,
    repoSshUrl,
    watchBranch,
    organizationId,
    newOrganizationName,
  } = req.body || {};
  const normalizedRepoSshUrl = String(repoSshUrl || '').trim();
  const normalizedWatchBranch = String(watchBranch || '').trim();
  const normalizedAutoBuildEnabled = Boolean(autoBuildEnabled);
  const projects = await getProjects();
  const project = projects.find((item) => item.id === id);

  if (!project) {
    return res.status(404).json({ message: '项目不存在' });
  }

  const repoChanged = project.repoSshUrl !== normalizedRepoSshUrl;
  const branchChanged = project.watchBranch !== normalizedWatchBranch;

  if (!canAccessProject(req.user, id)) {
    return res.status(403).json({ message: '你没有该项目的操作权限' });
  }

  if (runningExecutions.has(id)) {
    return res.status(409).json({ message: '项目正在执行中，暂不允许修改' });
  }

  if (!name || !script) {
    return res.status(400).json({ message: '项目名称和脚本不能为空' });
  }

  if (!PROJECT_TYPES.includes(type)) {
    return res.status(400).json({ message: '项目类型不合法' });
  }

  if (!NODE_VERSION_OPTIONS.includes(nodeVersion)) {
    return res.status(400).json({ message: 'Node.js 版本不合法' });
  }

  if (!PACKAGE_MANAGERS.includes(packageManager)) {
    return res.status(400).json({ message: '包管理工具不合法' });
  }

  if (normalizedAutoBuildEnabled && (!normalizedRepoSshUrl || !normalizedWatchBranch)) {
    return res.status(400).json({ message: '开启自动执行后，仓库地址和监听分支不能为空' });
  }

  // 处理组织
  let finalOrganizationId = '';
  const organizations = await getOrganizations();
  
  if (newOrganizationName && newOrganizationName.trim()) {
    const normalizedName = newOrganizationName.trim();
    const existingOrg = organizations.find(
      (org) => org.name.toLowerCase() === normalizedName.toLowerCase()
    );
    
    if (existingOrg) {
      return res.status(400).json({ message: `已存在「${existingOrg.name}」组织，请选择已有组织` });
    }
    
    const newOrg = {
      id: `org_${Date.now()}`,
      name: normalizedName,
      createdAt: new Date().toISOString(),
    };
    organizations.push(newOrg);
    await saveOrganizations(organizations);
    finalOrganizationId = newOrg.id;
  } else if (organizationId) {
    const org = organizations.find((o) => o.id === organizationId);
    if (!org) {
      return res.status(400).json({ message: '选择的组织不存在' });
    }
    finalOrganizationId = organizationId;
  } else {
    return res.status(400).json({ message: '请选择或创建一个组织' });
  }

  project.name = name;
  project.script = script;
  project.type = type;
  project.nodeVersion = nodeVersion;
  project.packageManager = packageManager;
  project.autoBuildEnabled = normalizedAutoBuildEnabled;
  project.repoSshUrl = normalizedRepoSshUrl;
  project.watchBranch = normalizedWatchBranch;
  project.organizationId = finalOrganizationId;
  if (!normalizedAutoBuildEnabled) {
    project.lastTriggeredCommit = '';
    project.lastSeenCommit = '';
    project.lastPolledAt = null;
  } else if (repoChanged || branchChanged) {
    project.lastTriggeredCommit = '';
    project.lastSeenCommit = '';
    project.lastPolledAt = null;
  }
  project.updatedAt = new Date().toISOString();

  await saveProjects(projects);
  await createAuditLog({
    actorAccount: req.user.account,
    action: 'project_update',
    targetType: 'project',
    targetId: id,
    detail: `更新项目 ${project.name}`,
  });
  await cleanupUnusedOrganizations();
  res.json(normalizeProject(project));
});

app.delete('/api/projects/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const projects = await getProjects();
  const nextProjects = projects.filter((item) => item.id !== id);

  if (nextProjects.length === projects.length) {
    return res.status(404).json({ message: '项目不存在' });
  }

  if (!canAccessProject(req.user, id)) {
    return res.status(403).json({ message: '你没有该项目的操作权限' });
  }

  if (runningExecutions.has(id)) {
    return res.status(409).json({ message: '项目正在执行中，暂不允许删除' });
  }

  const users = await getUsers();
  const nextUsers = users.map((user) => ({
    ...user,
    projectPermissions: (user.projectPermissions || []).filter(
      (projectId) => projectId !== id
    ),
  }));
  const executions = await getExecutions();
  const nextExecutions = executions.filter((item) => item.projectId !== id);

  await saveProjects(nextProjects);
  await saveUsers(nextUsers);
  await saveExecutions(nextExecutions);
  await createAuditLog({
    actorAccount: req.user.account,
    action: 'project_delete',
    targetType: 'project',
    targetId: id,
    detail: `删除项目 ${id}`,
  });
  await cleanupUnusedOrganizations();
  res.json({ success: true });
});

app.get('/api/projects/:id/executions', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const executions = await getProjectExecutionsForUser(req.user, id);

  if (executions === null) {
    return res.status(403).json({ message: '你没有该项目的操作权限' });
  }

  if (executions === undefined) {
    return res.status(404).json({ message: '项目不存在' });
  }

  res.json(executions);
});

app.get('/api/project-options', authMiddleware, async (req, res) => {
  res.json({
    projectTypes: PROJECT_TYPES,
    nodeVersions: NODE_VERSION_OPTIONS,
    packageManagers: PACKAGE_MANAGERS,
  });
});

app.get('/api/organizations', authMiddleware, async (req, res) => {
  const organizations = await getOrganizations();
  res.json(organizations);
});

app.post('/api/organizations', authMiddleware, async (req, res) => {
  const { name } = req.body || {};
  const normalizedName = String(name || '').trim();

  if (!normalizedName) {
    return res.status(400).json({ message: '组织名称不能为空' });
  }

  const organizations = await getOrganizations();
  const existingOrg = organizations.find(
    (org) => org.name.toLowerCase() === normalizedName.toLowerCase()
  );

  if (existingOrg) {
    return res.status(400).json({ message: `已存在「${existingOrg.name}」组织，请选择已有组织` });
  }

  const newOrg = {
    id: `org_${Date.now()}`,
    name: normalizedName,
    createdAt: new Date().toISOString(),
  };

  organizations.push(newOrg);
  await saveOrganizations(organizations);
  res.status(201).json(newOrg);
});

app.post('/api/git/branches', authMiddleware, async (req, res) => {
  const { repoSshUrl } = req.body || {};
  const normalizedRepoSshUrl = String(repoSshUrl || '').trim();

  if (!normalizedRepoSshUrl) {
    return res.status(400).json({ message: '仓库地址不能为空' });
  }

  try {
    const branches = await listRemoteBranches(normalizedRepoSshUrl);
    res.json({ branches });
  } catch (error) {
    res.status(400).json({
      message: error.message || '拉取远端分支失败，请检查仓库地址和服务器 SSH 配置',
    });
  }
});

app.get('/api/audits', authMiddleware, adminOnly, async (req, res) => {
  const auditLogs = await getAuditLogs();
  res.json(auditLogs);
});

app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  const users = await getUsers();
  res.json(users.map(sanitizeUser));
});

app.post('/api/users', authMiddleware, adminOnly, async (req, res) => {
  const { account, password, projectPermissions } = req.body || {};
  const users = await getUsers();

  if (!account || !password) {
    return res.status(400).json({ message: '账户和密码不能为空' });
  }

  if (users.some((user) => user.account === account)) {
    return res.status(400).json({ message: '账户已存在' });
  }

  const newUser = {
    account,
    password,
    projectPermissions: Array.isArray(projectPermissions) ? projectPermissions : [],
  };

  users.push(newUser);
  await saveUsers(users);
  await createAuditLog({
    actorAccount: req.user.account,
    action: 'user_create',
    targetType: 'user',
    targetId: account,
    detail: `创建用户 ${account}`,
  });
  res.status(201).json(sanitizeUser(newUser));
});

app.put('/api/users/:account', authMiddleware, adminOnly, async (req, res) => {
  const { account } = req.params;
  const { password, projectPermissions } = req.body || {};
  const users = await getUsers();
  const user = users.find((item) => item.account === account);

  if (!user) {
    return res.status(404).json({ message: '用户不存在' });
  }

  if (typeof password === 'string' && password.trim()) {
    user.password = password.trim();
  }

  user.projectPermissions = Array.isArray(projectPermissions)
    ? projectPermissions
    : [];

  await saveUsers(users);
  await createAuditLog({
    actorAccount: req.user.account,
    action: 'user_update',
    targetType: 'user',
    targetId: account,
    detail: `更新用户 ${account}`,
  });
  res.json(sanitizeUser(user));
});

app.delete('/api/users/:account', authMiddleware, adminOnly, async (req, res) => {
  const { account } = req.params;

  if (account === 'admin') {
    return res.status(400).json({ message: 'admin 账户不能删除' });
  }

  const users = await getUsers();
  const nextUsers = users.filter((item) => item.account !== account);

  if (nextUsers.length === users.length) {
    return res.status(404).json({ message: '用户不存在' });
  }

  await saveUsers(nextUsers);
  await createAuditLog({
    actorAccount: req.user.account,
    action: 'user_delete',
    targetType: 'user',
    targetId: account,
    detail: `删除用户 ${account}`,
  });
  res.json({ success: true });
});

let server = null;
let isShuttingDown = false;

loadSessionsIntoMemory()
  .then(() => {
    startAutoBuildScheduler();
    server = app.listen(port, () => {
      console.log(`server running at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('failed to initialize sessions', error);
    process.exit(1);
  });

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) {
    console.log(`[shutdown] already shutting down, ignoring ${signal}`);
    return;
  }
  isShuttingDown = true;
  
  console.log(`\n[shutdown] received ${signal}, starting graceful shutdown...`);
  
  // 停止自动构建调度器
  stopAutoBuildScheduler();
  
  // 停止所有运行中的执行
  await stopAllRunningExecutions();
  
  // 关闭HTTP服务器
  if (server) {
    server.close(() => {
      console.log('[shutdown] HTTP server closed');
      process.exit(0);
    });
    
    // 强制关闭超时
    setTimeout(() => {
      console.error('[shutdown] forced shutdown after timeout');
      process.exit(1);
    }, 15000);
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

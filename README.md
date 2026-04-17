# feBuilder

`feBuilder` 是一个面向 Node.js 项目的可视化构建执行平台，适合用来统一管理前端或 Node 工程的打包脚本、自动轮询仓库分支、查看执行日志，以及按组织与用户权限控制谁能操作哪些项目。

项目当前采用前后端分离架构：
- 前端：Vue 3 + Vue Router + Vite
- 后端：Express
- 存储：本地 JSON 文件，无需数据库

## 功能概览

- 项目管理：创建、编辑、复制、删除构建项目
- 环境配置：为每个项目选择 Node.js 版本与包管理器
- 手动执行：一键触发项目脚本，实时显示“执行中”状态
- 执行历史：查看每次执行的状态、日志、退出码、持续时间
- 自动构建：轮询 Git SSH 仓库分支，检测新提交后自动触发执行
- 组织管理：项目按组织归类，组织为必填
- 权限管理：管理员可按“组织 - 项目”结构为用户分配项目权限
- 审计日志：记录登录、登出、项目变更、执行操作、用户管理等行为
- 自动清理：删除或调整项目后，会自动清理未被任何项目引用的孤立组织

## 技术栈

- 前端：Vue 3、Vue Router、Vite
- 后端：Express、cors
- 运行时：Node.js（项目执行依赖 nvm / nvm-windows 切换版本）
- 数据存储：`data/*.json`

## 运行要求

### 基础要求

- Node.js 16+
- 推荐使用 `pnpm` 安装本项目依赖
- 项目执行机需要提前安装：
  - Git
  - npm
  - nvm（Linux / macOS）或 nvm-windows（Windows）

### Windows 重要提醒

如果服务部署在 Windows 上，`nvm-windows` 的版本必须是 `1.1.11` 或更低版本。

更高版本在本项目当前的脚本执行模式下，可能会弹窗报错：

```text
nvm for windows should be run from a terminal such as CMD or PowerShell
```

建议：
- Windows 部署时固定使用 `nvm-windows <= 1.1.11`
- 先在 `CMD` 或 `PowerShell` 中手动验证 `nvm install`、`nvm use`、`node -v` 均可正常执行
- 再启动 `feBuilder` 服务

## 快速开始

### 1. 安装依赖

```bash
git clone <your-repo-url>
cd flow
pnpm install
```

### 2. 启动开发环境

先启动后端：

```bash
pnpm server
```

再启动前端开发服务器：

```bash
pnpm dev
```

默认访问地址：
- 前端开发环境：[http://localhost:9898](http://localhost:9898)
- 后端 API：[http://localhost:3001](http://localhost:3001)

说明：
- Vite 开发端口当前是 `9898`
- 开发环境下，前端通过 Vite 代理把 `/api` 请求转发到 `3001`
- Vite 已忽略 `data/` 与 `.build/` 目录监听，避免构建过程频繁触发前端刷新

## 生产部署

当前后端仅提供 API，没有内置把 `dist/` 静态文件直接托管出去的逻辑。

这意味着生产部署通常有两种方式：
- 方式一：前端执行 `pnpm build` 后，由 Nginx、Caddy 或其他静态服务器托管 `dist/`，并把 `/api` 反向代理到 Node 服务
- 方式二：仅用于临时演示，前端用 `vite preview` 单独启动，后端仍由 `pnpm server` 启动

### 推荐部署步骤

1. 安装依赖

```bash
pnpm install
```

2. 构建前端

```bash
pnpm build
```

3. 启动后端

```bash
pnpm server
```

4. 使用静态 Web 服务器托管 `dist/`

需要确保浏览器访问前端时：
- 页面静态资源来自 `dist/`
- `/api` 请求能够转发到 `http://<your-host>:3001`

### Windows 部署建议

Windows 机器上建议逐项确认以下内容：
- 已安装 Git，且 `git` 命令可直接执行
- 已安装 npm
- 已安装 `nvm-windows <= 1.1.11`
- 在 `CMD` 或 `PowerShell` 中执行 `nvm version`、`nvm install 16.16.0`、`nvm use 16.16.0`、`node -v` 可以成功
- 服务器进程账户对项目目录、`data/`、`.build/` 目录有读写权限
- Git SSH 私钥已配置完成，且可访问目标仓库

## 默认账户

首次启动时，系统会自动创建管理员账户：

| 字段 | 值 |
| --- | --- |
| 账户 | `admin` |
| 密码 | `admin123` |

安全提醒：首次登录后请立即修改默认密码。

## 目录结构

```text
flow/
├── src/                     # 前端源码
├── server/                  # 后端源码
├── data/                    # JSON 数据目录，首次运行会自动创建
├── .build/                  # 项目执行临时目录，执行结束后自动清理
├── dist/                    # 前端构建产物
├── index.html
├── package.json
└── vite.config.js
```

其中主要数据文件包括：
- `data/users.json`：用户与项目权限
- `data/projects.json`：项目配置
- `data/organizations.json`：组织列表
- `data/executions.json`：执行历史
- `data/audit-logs.json`：审计日志
- `data/sessions.json`：登录会话

## 核心使用说明

### 1. 登录

使用默认管理员账户登录系统。

### 2. 创建组织

创建项目时，组织为必填项。你可以：
- 选择已有组织
- 直接输入新组织名称，提交时自动创建

如果新组织名称与现有组织重名，系统会拒绝创建并提示选择已有组织。

### 3. 创建项目

创建项目时需要填写：
- 项目名称
- 所属组织
- 项目类型：`testing` 或 `production`
- Node.js 版本
- 包管理器：`pnpm` / `npm` / `yarn`
- 执行脚本

示例脚本：

```bash
git clone -b master git@github.com:your-org/your-project.git && cd your-project && yarn install && yarn build
```

说明：
- 每次执行都会在 `.build/` 下生成独立临时目录
- 系统会先切换到项目指定的 Node.js 版本，再执行用户脚本
- 执行完成后会自动清理该次执行的临时目录

### 4. 执行项目

项目列表支持：
- 执行
- 停止
- 查看详情
- 复制
- 编辑
- 删除

当项目开始执行后，列表会立即显示“执行中”，无需手动刷新。

### 5. 自动构建

开启自动执行后，需要补充：
- Git SSH 仓库地址
- 监听分支

系统会在每天 `08:00 - 22:00` 之间，每 `3` 分钟轮询一次远端分支。
当检测到目标分支出现新的提交时：
- 若当前项目未在执行
- 且当前服务并发执行数未满

系统会自动发起构建。

当前默认限制：
- 最大并发执行数：`5`
- 每个项目最多保留最近 `10` 条执行记录

### 6. 用户与权限

只有 `admin` 可以访问用户管理和审计日志。

用户权限特点：
- 权限在界面中按“组织 - 项目”结构配置
- 勾选组织会自动选中该组织下所有项目
- 实际持久化到 `users.json` 的始终只有项目 ID
- 普通用户只能查看和操作自己有权限的项目

## 脚本执行机制

### Linux / macOS

系统会在执行用户脚本前自动追加以下引导逻辑：
- 加载 `nvm`
- `nvm install <nodeVersion>`
- `nvm use <nodeVersion>`
- 输出 `node -v`、`npm -v`
- 按需检查并安装 `pnpm` 或 `yarn`
- 最后执行项目自定义脚本

### Windows

Windows 环境下，系统会生成并执行批处理引导脚本，流程与 Unix 分支保持一致：
- `nvm install <nodeVersion>`
- `nvm use <nodeVersion>`
- 输出 `node -v`、`npm -v`
- 按需检查并安装 `pnpm` 或 `yarn`
- 执行项目自定义脚本

再次提醒：
- Windows 必须使用 `nvm-windows <= 1.1.11`
- 否则可能出现弹窗错误：`nvm for windows should be run from a terminal such as CMD or PowerShell`

## 配置项

以下配置位于 `server/index.js`：

- 服务端口：`const port = 3001`
- Node.js 可选版本：`NODE_VERSION_OPTIONS`
- 包管理器可选值：`PACKAGE_MANAGERS`
- 最大并发数：`MAX_CONCURRENT_EXECUTIONS`
- 自动轮询间隔：`AUTO_BUILD_SCAN_HEARTBEAT_MS`
- 自动轮询时间窗口：
  - `AUTO_BUILD_SCAN_WINDOW_START_MINUTE`
  - `AUTO_BUILD_SCAN_WINDOW_END_MINUTE`
- 执行历史保留数量：`EXECUTION_HISTORY_LIMIT`

## API 概览

### 认证接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/login` | 登录 |
| GET | `/api/me` | 获取当前登录用户 |
| POST | `/api/logout` | 退出登录 |

### 项目接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/projects` | 获取当前用户可见项目 |
| POST | `/api/projects` | 创建项目 |
| PUT | `/api/projects/:id` | 编辑项目 |
| DELETE | `/api/projects/:id` | 删除项目 |
| POST | `/api/projects/:id/run` | 手动执行项目 |
| POST | `/api/projects/:id/stop` | 停止执行中的项目 |
| GET | `/api/projects/:id/executions` | 获取项目执行历史 |
| GET | `/api/project-options` | 获取项目类型、Node 版本、包管理器选项 |

### 组织接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/organizations` | 获取组织列表 |
| POST | `/api/organizations` | 创建组织 |

### Git 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/git/branches` | 根据 SSH 仓库地址读取远端分支 |

### 用户接口（仅管理员）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/users` | 获取用户列表 |
| POST | `/api/users` | 创建用户 |
| PUT | `/api/users/:account` | 更新用户 |
| DELETE | `/api/users/:account` | 删除用户 |

### 审计接口（仅管理员）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/audits` | 获取审计日志 |

## 数据说明

### 删除 `data/` 目录会怎样？

可以正常重新启动。
系统会自动重建所需的数据文件，并恢复到初始状态。

但请注意：
- 所有项目、组织、用户、执行记录、审计日志、会话都会丢失
- 仅默认管理员账户会重新生成

因此生产环境仍然建议定期备份 `data/` 目录。

### 备份示例

Linux / macOS：

```bash
tar -czf backup-$(date +%Y%m%d-%H%M%S).tar.gz data
```

Windows 可以直接备份整个 `data` 文件夹。

## 常见问题

### 1. Windows 上弹出 `nvm for windows should be run from a terminal such as CMD or PowerShell`

原因：
- `nvm-windows` 版本过高，与当前服务的执行方式不兼容

解决办法：
- 将 `nvm-windows` 降级到 `1.1.11` 或更低版本
- 在 `CMD` 或 `PowerShell` 中手动验证 `nvm use` 是否可用
- 再重新启动服务并重试执行项目

### 2. 自动构建没有触发

请检查：
- 是否已开启自动执行
- `repoSshUrl` 与监听分支是否填写正确
- 服务器是否已配置 Git SSH 密钥
- 当前时间是否落在 `08:00 - 22:00` 轮询窗口内
- 当前项目是否已经有执行在进行中
- 当前服务是否已达到并发上限

### 3. 拉取远程分支失败

请检查：
- 仓库 SSH 地址是否正确
- 部署机器是否具备仓库访问权限
- `ssh -T` 或 `git ls-remote` 是否可在服务器上成功执行

### 4. 执行日志很快结束，但没有实际构建结果

建议检查：
- 部署机器上的 `nvm` 或 `nvm-windows` 是否可用
- Git、npm、pnpm、yarn 是否在服务进程环境变量中
- Windows 上是否使用了 `nvm-windows <= 1.1.11`
- 用户脚本本身在目标机器命令行中能否单独跑通

### 5. 如何增加可选 Node.js 版本

编辑 `server/index.js` 中的 `NODE_VERSION_OPTIONS`。

## 开发脚本

```bash
pnpm dev       # 启动前端开发服务器
pnpm server    # 启动后端服务
pnpm build     # 构建前端
pnpm preview   # 本地预览前端构建结果
```

## 安全建议

- 首次登录后立即修改默认管理员密码
- 生产环境限制 `3001` 端口的访问范围
- 为 Git SSH 密钥配置最小必要权限
- 定期备份 `data/` 目录
- 对公开仓库提交前再次检查是否包含密码、Token、私钥等敏感信息

## 许可

如需补充许可证，请在仓库中新增对应 `LICENSE` 文件。

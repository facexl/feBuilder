# feBuilder - 云打包工具

一个用于管理和执行 Node.js 项目构建脚本的 Web 工具，支持自动轮询 Git 仓库触发构建。

## 功能特性

- 📦 **项目管理** - 创建、编辑、删除构建项目
- 🏢 **组织管理** - 按组织分类管理项目
- 🚀 **一键执行** - 手动触发构建脚本
- 🔄 **自动构建** - 轮询 Git 仓库，检测新提交自动构建
- 👥 **用户管理** - 多用户支持，基于组织的权限控制
- 📋 **执行历史** - 查看构建日志和执行状态
- 🔍 **操作审计** - 记录所有操作日志

## 技术栈

- **前端**: Vue 3 + Vue Router + Vite
- **后端**: Express.js
- **存储**: JSON 文件（无需数据库）

## 快速开始

### 环境要求

- Node.js >= 16
- pnpm（推荐）或 npm
- nvm（用于管理 Node.js 版本）

### 安装

```bash
# 克隆项目
git clone <repository-url>
cd feBuilder

# 安装依赖
pnpm install
```

### 开发模式

```bash
# 启动前端开发服务器（端口 5173）
pnpm dev

# 启动后端服务器（端口 3000）
pnpm server
```

访问 http://localhost:5173

### 生产部署

```bash
# 构建前端
pnpm build

# 启动服务
pnpm server
```

访问 http://localhost:3000

## 默认账户

首次启动时会自动创建管理员账户：

| 字段 | 值 |
|------|-----|
| 账户 | `admin` |
| 密码 | `admin123` |

> ⚠️ **安全提醒**: 首次登录后请立即修改默认密码！

## 配置说明

### 服务器配置

默认端口为 `3000`，可在 `server/index.js` 中修改：

```javascript
const port = 3000;
```

### 自动构建时间窗口

默认在 08:00 - 22:00 之间每 3 分钟轮询一次，可在 `server/index.js` 中修改：

```javascript
const AUTO_BUILD_SCAN_HEARTBEAT_MS = 3 * 60 * 1000;  // 轮询间隔
const AUTO_BUILD_SCAN_WINDOW_START_MINUTE = 8 * 60;   // 开始时间（分钟）
const AUTO_BUILD_SCAN_WINDOW_END_MINUTE = 22 * 60;    // 结束时间（分钟）
```

### 并发执行数

默认最大 5 个并发构建，可在 `server/index.js` 中修改：

```javascript
const MAX_CONCURRENT_EXECUTIONS = 5;
```

## 项目结构

```
feBuilder/
├── src/                    # 前端源码
│   ├── App.vue            # 主应用组件
│   ├── main.js            # 入口文件
│   ├── pages/             # 页面组件
│   ├── context/           # 状态管理
│   └── styles.css         # 全局样式
├── server/                 # 后端源码
│   ├── index.js           # 服务器入口
│   └── json-store.js      # JSON 存储工具
├── data/                   # 数据目录（自动创建）
│   ├── users.json         # 用户数据
│   ├── projects.json      # 项目数据
│   ├── organizations.json # 组织数据
│   ├── executions.json    # 执行历史
│   ├── audit-logs.json    # 审计日志
│   └── sessions.json      # 会话数据
├── .build/                 # 构建临时目录（自动创建）
└── dist/                   # 前端构建产物
```

## API 文档

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/login` | 登录 |
| GET | `/api/me` | 获取当前用户 |
| POST | `/api/logout` | 登出 |

### 项目

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects` | 获取项目列表 |
| POST | `/api/projects` | 创建项目 |
| PUT | `/api/projects/:id` | 更新项目 |
| DELETE | `/api/projects/:id` | 删除项目 |
| POST | `/api/projects/:id/run` | 执行项目 |
| POST | `/api/projects/:id/stop` | 停止执行 |
| GET | `/api/projects/:id/executions` | 获取执行历史 |

### 组织

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/organizations` | 获取组织列表 |
| POST | `/api/organizations` | 创建组织 |

### 用户（仅管理员）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/users` | 获取用户列表 |
| POST | `/api/users` | 创建用户 |
| PUT | `/api/users/:account` | 更新用户 |
| DELETE | `/api/users/:account` | 删除用户 |

### 审计日志（仅管理员）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/audits` | 获取审计日志 |

### Git

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/git/branches` | 获取远程分支列表 |

## 使用指南

### 1. 创建组织

在创建项目前，需要先有组织。创建项目时可以输入新组织名称自动创建。

### 2. 创建项目

1. 点击「创建项目」
2. 填写项目名称
3. 选择或输入组织
4. 选择项目类型（测试环境/线上环境）
5. 选择 Node.js 版本和包管理工具
6. 输入构建脚本（如 `pnpm build`）

### 3. 自动构建配置

1. 开启「自动执行」开关
2. 填写 Git SSH 仓库地址（如 `git@github.com:user/repo.git`）
3. 选择监听分支
4. 系统会在 08:00-22:00 间每 3 分钟检查一次
5. 检测到新提交时自动触发构建

### 4. 用户权限管理（管理员）

- 创建用户时可以分配项目权限
- 权限按组织分组，勾选组织自动选中所有项目
- 用户只能看到和操作有权限的项目

## 数据备份

重要数据位于 `data/` 目录，建议定期备份：

```bash
# 备份数据
tar -czf backup-$(date +%Y%m%d).tar.gz data/

# 恢复数据
tar -xzf backup-20240101.tar.gz
```

## 常见问题

### Q: 删除 data 目录会怎样？
A: 可以正常运行。系统会自动重建所有数据文件，恢复为初始状态（只有默认管理员账户）。

### Q: 如何修改端口？
A: 编辑 `server/index.js`，修改 `const port = 3000;` 为你需要的端口。

### Q: 自动构建不工作？
A: 检查以下几点：
- 确保服务器已配置 SSH 密钥可以访问 Git 仓库
- 确保当前时间在 08:00-22:00 范围内
- 检查服务器日志是否有错误信息

### Q: 如何支持更多 Node.js 版本？
A: 编辑 `server/index.js`，在 `NODE_VERSION_OPTIONS` 数组中添加版本号。

## 开发

### 代码规范

- 使用 ESLint 进行代码检查
- 使用 Prettier 进行代码格式化

```bash
# 检查代码
pnpm lint

# 格式化代码
pnpm format
```

## 许可证

[MIT](LICENSE)

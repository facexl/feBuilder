# 云打包工具

一个基于 Node.js + Vue 3 的前端网页项目管理工具，使用 JSON 文件保存用户与项目配置。

## 功能

- 登录
- 项目列表
- 用户管理（仅 `admin` 可见）
- 项目权限分配

## 项目字段

- `id`
- `name`（项目名称）
- `script`（脚本）
- `createdAt`（创建时间）
- `updatedAt`（更新时间）

## 用户字段

- `account`（账户）
- `password`（密码）
- `projectPermissions`（项目权限）

## 启动方式

1. 安装依赖

```bash
npm install
```

2. 启动后端

```bash
npm run server
```

3. 启动前端

```bash
npm run dev
```

默认管理员账号：

- 账户：`admin`
- 密码：`admin123`

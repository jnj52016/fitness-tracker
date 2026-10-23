# 练就 · 四分化训练

React + TypeScript + Ant Design 前端，Node.js + SQLite 后端，pnpm 工作区。使用用户名和密码注册、登录；训练计划、进行中的组数和历史记录按账号保存在后端。

现有线上入口 https://bianfu.site/fitness-tracker/ 仍是旧静态版本，本次后端尚未部署。

## 本地启动

环境：Node.js 24+、pnpm 10.18.3。

```sh
pnpm install
pnpm dev
```

浏览器访问 http://localhost:5173，前端将 `/fitness-tracker/api` 代理至 `127.0.0.1:3001`。手机同 Wi-Fi 访问电脑的 5173 端口即可；不需要暴露数据库端口。注册用户名为 3–32 位字母、数字或下划线（不区分大小写），密码为 8–128 位。无手机号、邮箱验证及自助找回密码。

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

构建后 `pnpm start` 启动同一个 Node 服务提供页面和 API，访问 http://localhost:3001/fitness-tracker/。默认绑定 127.0.0.1；需要容器或局域网访问时设置 `HOST=0.0.0.0`。

## 数据与功能

- 四分化动作设置、加组撤销、提前结束、历史筛选与统计保留。
- 腿臀 A/B 分别保存动作与组数，结束后自动交替；未开始时可手动切换，历史标记实际方案。
- 胸部、腹部可选每轮或隔轮训练；隔轮在第 1、3、5…轮安排，不影响肩部和手臂。结束大臂腹后进入下一轮。
- 旧数据自动兼容：原腿臀配置保留为 A 并复制到 B，频率默认每轮；修改任一套不影响另一套。
- 每次写入经服务器确认后更新界面；断网或保存失败会提示，需要联网使用。
- 同账号换设备登录即可读取数据；切回窗口会刷新，冲突时拒绝旧版本覆盖，提示重新操作。
- 登录会话使用 HttpOnly Cookie，30 天到期；密码使用随机盐和 scrypt 哈希，数据库不存明文密码。
- 页面仅保留「我的训练」「历史统计」，右上角显示用户名并支持退出登录。
- 用户端不再提供备份、恢复、清空或旧数据迁移入口。数据库备份由服务端运维负责，自动备份尚待上线时配置。

## 目录

- `apps/web/src/Auth.tsx`：登录、注册、会话恢复。
- `apps/web/src/App.tsx`：训练页面、历史统计与顶部账号操作。
- `apps/web/src/data/storage.ts`：HTTP 存储与版本冲突保护。
- `apps/web/src/data/legacyStorage.ts`：旧 IndexedDB 兼容工具（当前页面不再调用）。
- `apps/web/src/data/model.ts`：前后端共用训练与备份校验规则。
- `apps/api/server.cjs`：API、SQLite、会话与静态页面服务。
- `apps/api/data/fitness.sqlite`：默认数据库（不提交代码库）。

## 部署

新版本需要常驻 Node 服务与持久化磁盘，不能只上传前端静态目录。原 `deploy:cloudbase` 静态发布命令已移除，避免发布无法连接 API 的页面。

生产环境设置 `NODE_ENV=production`、`APP_ORIGIN=https://bianfu.site`、`DATABASE_PATH=/持久化目录/fitness.sqlite`，构建后启动。反向代理将 `/fitness-tracker/` 转发到 Node 服务，保留博客 `/`；不添加跨域 CORS。详细配置及 SQLite 备份见[后端部署说明](docs/项目参考/账号与后端部署.md)。

[文档入口](docs/README.md) · [TODO](docs/todo.md)

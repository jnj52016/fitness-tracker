# 账号与训练数据 API

基础路径 `/fitness-tracker/api`；同源 JSON 接口，OpenAPI 见 [account.openapi.yaml](account.openapi.yaml)。旧 `/api/health` 定义仅为历史资料。

| 方法与路径 | 输入 | 结果 |
| --- | --- | --- |
| GET /health | 无 | `{status: "ok"}` |
| POST /register | `{username, password}` | 注册并设置会话 Cookie，返回 `{id, username}` |
| POST /login | 同上 | 登录并设置会话 Cookie，返回用户 |
| GET /me | Cookie | 当前用户；未登录 401 |
| POST /logout | Cookie、`{}` | 注销当前会话、清 Cookie，返回 `{ok: true}` |
| GET /data | Cookie、X-User-Id | 当前用户 TrainingData |
| PUT /data | Cookie、X-User-Id、`{data, expectedRevision}` | 完整替换训练数据，返回服务器递增 revision 后的 TrainingData |

用户名转小写保存，匹配 `[a-zA-Z0-9_]{3,32}`，密码长度 8–128。不返回密码哈希。登录失败统一提示用户名或密码错误。Cookie 名 `fitness_session`，路径 `/fitness-tracker/api`，HttpOnly、SameSite=Strict，生产环境 Secure，30 天过期。

写请求必须携带配置的 Origin，JSON 请求 Content-Type 为 application/json。数据接口的 `X-User-Id` 必须匹配 Cookie 解析出的用户 id；不能靠请求体或该 header 选择其他用户。注册用户名重复返回 409；数据 revision 冲突返回 409，需重新 GET 后再次编辑，禁止直接覆盖重试。

TrainingData 与前端备份中的 data 相同，定义及白名单重建规则由 `apps/web/src/data/model.ts` 共用：version=2、revision、chosen、current（0–3）、四分化 configs、counts、startedAt 和 history。动作需属于对应分化、不重复；目标组数 1–20，完成组数 0–目标；历史最多 10000 条，时间、日期和历史 id 校验有效。PUT 的客户端 data.revision 不决定保存版本，expectedRevision 才是并发前置条件。导入或清空也走此接口，不删除账号。

失败返回 `{message: string}`。400 输入无效，401 未登录/过期/账号切换，403 Origin 不匹配，404 接口不存在，405 方法不支持，409 重名或冲突，413 超过 5 MB，415 Content-Type 错误，429 认证限流，500 服务异常。失败不静默回退到本地存储。网络中断可能发生在服务器已写入之后，重新加载确认最新结果再操作。


## 轮换字段与升级

GET /data 自动将旧 version=1 规范化为 version=2，不更改数据库 revision；下一次成功保存持久化新结构。PUT /data 必须为 version=2，旧客户端写入返回 409 并要求刷新，防止旧页面丢弃轮换字段。

- configs[2]：腿臀 A；legB：腿臀 B，校验规则与腿臀 A 相同。
- legNext：A / B，当前或下一次腿臀使用的方案。
- round：当前四分化轮次，1–1000000。
- frequency：{chest: every | alternate, abs: every | alternate}；alternate 在奇数轮训练该部分。
- history[].legVariant：仅腿臀记录可有 A / B，旧记录可不提供。

旧数据默认 legNext=A、round=1、频率均 every，原腿臀复制到 legB。已选动作计数按实际启用方案校验。结束腿臀在同一次带 revision 的保存中写入历史并切换方案，结束大臂腹推进 round。

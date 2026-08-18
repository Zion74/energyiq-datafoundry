---
title: "EnergyIQ 生产不可变 Release 部署与回滚 Runbook"
summary: "用真实 release 目录、强制构建、精确 SHA、独立 Metadata 备份和原子 current 切换防止部署覆盖旧版本。"
doc_type: implementation
tags: [deployment, release, rollback, production]
updated_at: "2026-08-18"
status: accepted
related:
  - "2026-08-17-Preschool-Stage3-native-submit-unavailable修复记录.md"
---

# EnergyIQ 生产不可变 Release 部署与回滚 Runbook

## 1. 解决的问题

过去的手工发布把 `current` symlink 本身复制到 `releases/<sha>`，导致新“release”仍指向旧 physical release；覆盖源码和构建后，旧版本也被修改，回滚标签失真。复制的 TypeScript `*.tsbuildinfo` 又可能让 `tsc -b` 复用旧输出。

仓库入口 `scripts/energyiq/deploy-release.mjs` 采用以下边界：

- 从一个精确 Git checkout 的内容创建新的 physical release，不复制 `current` symlink；
- 排除 `.git`、`node_modules`、`dist`、`.next` 和 `*.tsbuildinfo`；
- 固定执行 `npm ci`、`npm run build -- --force`、`npm run build:web`；
- 构建后再次校验 `.release-sha` 和 `RELEASE_SHA`；
- 切换前、切换后分别检查 API health、Web login 和一个 exact Overview；
- Linux 使用同一目录内 symlink rename 原子切换 `current`；
- 新 release smoke 失败时自动切回旧 physical release、重启并再次 smoke；
- 不自动删除 staging、failed release、previous release 或备份，便于审计和恢复。

## 2. 发布前人工门

1. 本地 `main` 必须 clean，目标 SHA 已 push，并通过 scoped tests、root build 和 Web build。
2. 在服务器创建目标 SHA 的独立 checkout，例如 `/opt/energyiq-datafoundry/incoming/<sha>`；`git rev-parse HEAD` 必须等于目标 SHA。
3. 记录当前 physical release：

   ```bash
   readlink -f /opt/energyiq-datafoundry/current
   ```

4. 在 `/opt/energyiq-datafoundry` 外完成 Metadata/Storage 一致性备份并校验。SQLite 必须连同 WAL/SHM 一致处理；若无法在线一致备份，先进入维护窗口停止写入。
5. 备份路径不得位于应用根目录，也不得通过 symlink 指回应用根目录。
6. 确认服务单元名和三个本机 smoke URL；Overview URL 必须包含一个真实 Project 和精确业务入口。

## 3. 执行发布

```bash
SHA="<40-character-git-sha>"

npm run deploy:energyiq:release -- \
  --app-root /opt/energyiq-datafoundry \
  --source-dir "/opt/energyiq-datafoundry/incoming/${SHA}" \
  --release-sha "${SHA}" \
  --metadata-backup "/var/backups/energyiq/<timestamp>/storage.tar.zst" \
  --api-service energyiq-api.service \
  --web-service energyiq-web.service \
  --smoke-url http://127.0.0.1:8787/healthz \
  --smoke-url http://127.0.0.1:3000/login \
  --smoke-url 'http://127.0.0.1:3000/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity'
```

服务单元名必须以服务器实际配置为准，不能直接复制示例猜测。

成功后核对：

```bash
CURRENT="$(readlink -f /opt/energyiq-datafoundry/current)"
test "${CURRENT}" = "/opt/energyiq-datafoundry/releases/${SHA}"
test -d "${CURRENT}"
test ! -L "${CURRENT}"
test "$(cat "${CURRENT}/.release-sha")" = "${SHA}"
test "$(cat "${CURRENT}/RELEASE_SHA")" = "${SHA}"
```

## 4. 失败语义

- **切换前失败**：`current` 和现有服务保持不变；`.staging-<sha>` 保留供诊断。
- **切换后 smoke 失败**：脚本自动把 `current` 切回原 physical release、重启服务并复查三项 smoke；失败的新 release 保留。
- **回滚 smoke 也失败**：脚本返回组合错误。此时不要删除任何 release 或备份，先检查服务日志和外部依赖。
- **目标 staging/final 已存在**：脚本拒绝覆盖。先人工确认其来源；不要用递归删除让重试“通过”。

## 5. 手工回滚兜底

只有在自动回滚未完成、且已核对旧 physical release 路径后执行：

```bash
APP_ROOT=/opt/energyiq-datafoundry
PREVIOUS="<verified-physical-release-path>"

test -d "${PREVIOUS}"
test ! -L "${PREVIOUS}"
ln -s "${PREVIOUS}" "${APP_ROOT}/.current-rollback"
mv -Tf "${APP_ROOT}/.current-rollback" "${APP_ROOT}/current"
systemctl restart energyiq-api.service energyiq-web.service
```

随后重新检查 health、login、Preschool/Ngee Ann Overview、账户隔离和普通刷新零 Provider Run。只有确实需要回退 Metadata schema/data 时，才恢复完整 Storage 备份；不要只覆盖单个 SQLite 主文件。

## 6. 自动化证据与剩余人工验收

运行：

```bash
node --test scripts/energyiq/deploy-release.test.mjs
```

自动测试覆盖 physical release、强制构建、SHA marker、防 symlink 假备份和 post-switch 自动回滚。它不等于真实服务器部署、多账户、Provider、浏览器或客户验收。

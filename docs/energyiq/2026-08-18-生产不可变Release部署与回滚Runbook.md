---
title: "EnergyIQ 生产不可变 Release 部署与回滚 Runbook"
summary: "验证预构建 Artifact 后解压为 physical release，以 deploy lock、原子 current 切换和自动回滚保护生产发布。"
doc_type: implementation
tags: [deployment, release, artifact, rollback, production]
updated_at: "2026-08-20"
status: accepted
related:
  - "2026-08-20-DPL-01-Release-Artifact-Contract.md"
  - "2026-08-20-EnergyIQ快速发布Pipeline方案与决策请求.md"
---

# EnergyIQ 生产不可变 Release 部署与回滚 Runbook

## 1. 当前边界

仓库入口 `scripts/energyiq/deploy-release.mjs` 消费 DPL-01 生成的三个不可变文件：

```text
energyiq-<SHA>.tar
energyiq-<SHA>.manifest.json
energyiq-<SHA>.sha256
```

部署脚本保证：

- 以独占 `.deploy.lock` 串行化发布；已有 lock 时 fail closed，不猜测或删除；
- 在任何解压、dependency install、`current` 切换或 service restart 前调用
  `verifyReleaseArtifact`；
- 从收到的字节重新校验 Artifact SHA-256、checksum、逐 entry hash、Git SHA、
  `package-lock` hash、Web BUILD_ID、identity marker 和 Release Host exact Node；
- malformed/tail/symlink/non-regular tar entry 全部拒绝；
- 只从已验证内存 entry 解压到新的 `.staging-<SHA>`，避免 verify 后换包；
- 新建 physical `releases/<SHA>`，不覆盖现有 release；
- 切换前、切换后分别检查 API health、Web login 和 exact Overview；
- Linux 使用同目录 symlink rename 原子切换 `current`；
- post-switch 失败后自动切回旧 physical release、重启并再次 smoke；
- rollback 也失败时保留 `.deploy.lock`，阻止下一次自动发布覆盖事故现场；
- 生产部署路径不执行 TypeScript build 或 Next build。

## 2. DPL-03 前的显式依赖过渡

DPL-03 尚未决定 self-contained production dependencies 或 lock-hash dependency layer。
因此当前命令必须显式传：

```text
--dependency-install transitional-npm-ci
```

该 seam 只在新 staging release 内执行：

```text
npm ci --omit=dev --ignore-scripts
```

它不复用、链接或修改其他 release 的 `node_modules`，不运行 lifecycle/build script，并在命令后
重新校验 `package-lock.json` 未变化。这仍然让生产机承担 dependency install，不能描述为最终“纯
Release Host”。DPL-03 完成后应替换此 seam，而不是静默改变它的含义。

## 3. 发布前人工门

1. Build Host checkout 必须 clean；Artifact 三件套来自同一 exact SHA，并通过 DPL-01 tests、
   root build 和 Web production build。
2. Artifact Manifest `nodeVersion` 必须和 Release Host `node --version` 完全一致；只比较 major
   version 不合格。
3. 三件套上传到独立 incoming 路径；不得用 symlink 作为 Artifact/Manifest/checksum 输入。
4. 记录当前 physical release：

   ```bash
   readlink -f /opt/energyiq-datafoundry/current
   ```

5. 在 `/opt/energyiq-datafoundry` 外完成 Metadata/Storage 一致性备份并校验。SQLite 必须连同
   WAL/SHM 一致处理；无法在线一致备份时先进入维护窗口停止写入。
6. 备份路径不得位于应用根目录，也不得通过 symlink 指回应用根目录。
7. 确认 `.deploy.lock`、`.current-next`、`.current-previous`、目标 staging 和目标 release 均不存在。
   若存在，停止并诊断；不要删除后盲重试。
8. 确认实际 systemd unit 和三个本机 smoke URL。Overview URL 必须包含真实 Project 和精确业务入口。

## 4. 执行发布

```bash
SHA="<40-character-git-sha>"
INCOMING="/opt/energyiq-datafoundry/incoming/${SHA}"

npm run deploy:energyiq:release -- \
  --app-root /opt/energyiq-datafoundry \
  --artifact "${INCOMING}/energyiq-${SHA}.tar" \
  --manifest "${INCOMING}/energyiq-${SHA}.manifest.json" \
  --checksum "${INCOMING}/energyiq-${SHA}.sha256" \
  --release-sha "${SHA}" \
  --metadata-backup "/var/backups/energyiq/<timestamp>/storage.tar.zst" \
  --dependency-install transitional-npm-ci \
  --api-service energyiq-api.service \
  --web-service energyiq-web.service \
  --smoke-url http://127.0.0.1:8787/healthz \
  --smoke-url http://127.0.0.1:3000/login \
  --smoke-url 'http://127.0.0.1:3000/energyiq/overview?projectId=preschool-demo&scopeId=project&resource=electricity'
```

服务单元名和 URL 必须以服务器实际配置为准，不能直接复制示例猜测。脚本从当前
`process.version` 获取 Release Host Node，不接受 Operator 传一个伪造的 expected Node 值。

成功后核对：

```bash
CURRENT="$(readlink -f /opt/energyiq-datafoundry/current)"
test "${CURRENT}" = "/opt/energyiq-datafoundry/releases/${SHA}"
test -d "${CURRENT}"
test ! -L "${CURRENT}"
test "$(cat "${CURRENT}/.release-sha")" = "${SHA}"
test "$(cat "${CURRENT}/RELEASE_SHA")" = "${SHA}"
test "$(jq -r .gitSha "${CURRENT}/release-manifest.json")" = "${SHA}"
test ! -e /opt/energyiq-datafoundry/.deploy.lock
```

## 5. 失败语义

- **Artifact/checksum/Manifest/SHA/Node 失败**：不解压、不安装依赖、不 smoke、不修改 `current`、
  不 restart；释放本次创建的 lock。
- **pre-switch smoke 失败**：不创建 staging/final，`current` 和现有服务保持不变。
- **解压或 transitional dependency install 失败**：保留 staging 供诊断，`current` 不变；
  lock 正常释放。
- **post-switch smoke 失败**：切回 verified previous physical release、restart 并再次 smoke；
  失败的新 physical release 保留。
- **rollback 也失败**：返回组合错误并保留 `.deploy.lock`；停止自动操作，人工核对 current、
  processes、logs 和 shared dependencies。
- **目标 staging/final 已存在**：拒绝覆盖；不要用递归删除让重试“通过”。

代码回滚不修改 Shared Storage。只有独立 Data Release 明确执行了不兼容 migration，才按其一致性
备份策略恢复 Storage；不能只覆盖 SQLite 主文件。

## 6. 手工回滚兜底

只有在自动回滚未完成、并核对旧 physical release 后执行：

```bash
APP_ROOT=/opt/energyiq-datafoundry
PREVIOUS="<verified-physical-release-path>"

test -d "${PREVIOUS}"
test ! -L "${PREVIOUS}"
ln -s "${PREVIOUS}" "${APP_ROOT}/.current-rollback"
mv -Tf "${APP_ROOT}/.current-rollback" "${APP_ROOT}/current"
systemctl restart energyiq-api.service energyiq-web.service
```

随后重查 health、login、两个客户 Overview、账户隔离和普通刷新 zero Provider Run。事故解除并记录后，
才可人工移走 retained `.deploy.lock`；不要在系统仍不明时删除 lock。

## 7. 自动化证据与剩余人工验收

运行：

```powershell
node --test scripts/energyiq/build-release-artifact.test.mjs scripts/energyiq/deploy-release.test.mjs
```

自动测试覆盖 Artifact 验证顺序、malformed/tail/symlink、deploy lock、physical release、显式 dependency
seam、无 production full build、pre-switch 不变性、post-switch 自动回滚和 Shared Storage 不变性。
它不等于真实服务器、systemd、多账户、Provider、浏览器或客户价值验收。

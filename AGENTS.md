# AI 协作入口：dsh-claude-desktop

项目用途：基于 Electron 的独立 DeepSeek Harness 桌面客户端。

## 云端工作约定

1. 先读 `README.md`、本文件及目标目录的局部说明，再确认当前分支、工作区变化和任务范围。仓库文档与实际 manifest 不一致时以当前代码为准，并记录差异。
2. 不假设云端已有本机依赖、浏览器、全局 CLI、绝对路径或认证。按仓库锁文件和 manifest 安装；缺少能力时报告限制。
3. 用小范围分支和 PR 交付。PR 写清问题、修改、执行过的验证及仍待验证事项；文档存在不等于功能验证通过。
4. 保留无关工作区改动。修改公共接口时检查消费者，不顺手改部署配置或重构其他模块。
5. 密钥只从任务环境/secret 配置读取；日志脱敏。使用合成测试数据，不提交个人资料或运行输出。

## 项目地图

src/main/、src/preload/、src/renderer/、src/shared/、tests/、scripts/、SECURITY.md、DSH_HEADLESS.md。

## 环境与验证

Node.js >=22；npm ci。

```sh
npm run verify
```

## 项目约束

维持 contextIsolation、sandbox 与窄 IPC；不在 renderer 导入 DSH 内部实现。DSH 运行时独立安装，不自动下载替换。改 updater/proxy 时先读 SECURITY.md。tag 会触发公开 release，发布须有明确任务范围。

## 云端验证边界

云端可做类型检查、单元测试与构建；真实桌面、macOS 打包与 DSH 联调需对应系统环境。DSH 固定兼容 0.1.0-rc.6；不能将纯 UI 或 mock 验证写成完整 Harness 联调完成。

# 参与 Edge Switch

感谢参与。提交前请阅读 [AGENTS.md](AGENTS.md) 中的产品定位，并说明改动解决的问题及验证结果；不要提交凭据、客户数据、缓存或构建产物。

## 贡献许可

社区版继续采用 [AGPL-3.0-only](LICENSE)。项目同时开发闭源收费的企业版；为了允许公共修复在两个版本间复用，我们要求外部贡献者明确接受 [CLA v1.0](CLA.md)。你保留著作权，CLA 另外授予维护者商业许可、闭源分发及再许可所需的权利。不同意 CLA 时请勿提交需要此授权的贡献；仅讨论问题无需签署。

1. 阅读 CLA，确认拥有贡献权利，并取得雇主或其他权利人的必要授权。
2. 提交 PR，在 PR 中披露第三方代码来源、许可证和共同作者。
3. 在 PR 单独评论：

   I have read and agree to the Edge Switch CLA v1.0.

4. 每位贡献者分别以自己的账号确认；不要替其他人签署。每个 PR 都需要签署记录。

## 维护者合并检查

- `cla/contributor-license` 状态检查签署评论是否存在、账号是否匹配，并检查提交作者；它不验证法律身份或雇主授权。
- 未关联 GitHub 账号的提交作者、共同作者、机器人或组织权利须人工核实。无法在 GitHub 完成检查时，先取得充分的书面授权并修正提交署名，不得通过代签绕过检查。
- 合并前保存 CLA 版本、贡献者账号、PR、签署评论永久链接及提交 SHA；重要贡献另行保留授权记录。
- 维护者 `luozhang1024` 作为许可接收方无需向自己签署；这不免除其对第三方材料的核查。
- main 分支使用 `Contributor license agreement` 规则集，要求 `cla/contributor-license` 状态通过。仓库管理员保留绕过权限，以支持维护者直接提交；请勿用该权限合并未经授权的外部贡献。新仓库复用这些文件时仍需单独配置规则集，仅添加工作流不会自动开启分支保护。
- CLA 检查使用受信任的默认分支脚本，不运行 PR 中的代码，也不需要个人访问令牌。

开发验证入口：前端 `npm test`、`npm run build`；Rust `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib`；Python `python -m pytest -q`。按改动范围运行相关检查。

CLA 工作流逻辑测试：`node --test .github/scripts/cla.test.cjs`。

use crate::{
    store::{self, Profile},
    tasks, transport, Core,
};
use futures_util::StreamExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

pub fn client(proxy: bool, port: u16) -> Result<reqwest::Client, String> {
    let mut b = reqwest::Client::builder()
        .no_proxy()
        .https_only(false)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(45))
        .user_agent("EdgeSwitch/2.0");
    if proxy {
        b = b.proxy(
            reqwest::Proxy::all(format!("http://127.0.0.1:{port}")).map_err(|e| e.to_string())?,
        );
    }
    b.build().map_err(|e| e.to_string())
}
fn directory(core: &Core) -> PathBuf {
    core.store.lock().unwrap().directory.clone()
}
async fn hash(path: &Path) -> Result<String, String> {
    use tokio::io::AsyncReadExt;
    let mut f = tokio::fs::File::open(path)
        .await
        .map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = vec![0; 1024 * 1024];
    loop {
        let n = f.read(&mut buf).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
fn network_error(_: reqwest::Error) -> String {
    "网络请求失败，请检查电脑下载代理与目标站点；未记录请求凭据".into()
}
async fn download(
    c: &reqwest::Client,
    url: &str,
    path: &Path,
    checksum: &str,
    limit: u64,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    if path.exists() && hash(path).await? == checksum {
        return Ok(());
    }
    if !url.starts_with("https://") {
        return Err("下载地址必须为 HTTPS".into());
    }
    fs::create_dir_all(path.parent().ok_or("缓存目录无效")?).map_err(|e| e.to_string())?;
    let temp = path.with_extension(format!("{}.partial", store::new_id()));
    let result = async {
        let response = c
            .get(url)
            .timeout(Duration::from_secs(900))
            .send()
            .await
            .map_err(network_error)?
            .error_for_status()
            .map_err(network_error)?;
        if response.url().scheme() != "https" {
            return Err("下载重定向到非 HTTPS 地址".into());
        }
        let mut stream = response.bytes_stream();
        let mut f = tokio::fs::File::create(&temp)
            .await
            .map_err(|e| e.to_string())?;
        let mut total = 0u64;
        let mut h = Sha256::new();
        while let Some(block) = stream.next().await {
            let block = block.map_err(network_error)?;
            total += block.len() as u64;
            if total > limit {
                return Err("下载文件超过大小限制".into());
            }
            h.update(&block);
            f.write_all(&block).await.map_err(|e| e.to_string())?;
        }
        f.sync_all().await.map_err(|e| e.to_string())?;
        drop(f);
        if format!("{:x}", h.finalize()) != checksum {
            return Err("下载文件 SHA-256 校验失败，未安装".into());
        }
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        fs::rename(&temp, path).map_err(|e| e.to_string())?;
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
async fn upload(p: &Profile, source: &Path, target: &str) -> Result<(), String> {
    if !target.starts_with('/') || target.chars().any(char::is_control) {
        return Err("远程上传目录无效".into());
    }
    let mut c = transport::command("scp");
    c.args(transport::options(p, true))
        .args(["-P", &p.port.to_string()])
        .arg(source)
        .arg(format!("{}@{}:{target}", p.user, p.host));
    transport::output(c, 300).await?;
    Ok(())
}
pub async fn versions(p: &Profile) -> Result<Value, String> {
    let c = client(p.proxy, p.proxy_port)?;
    let mut result = json!({});
    let re = regex::Regex::new(r"^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$").unwrap();
    for (tool, package) in [
        ("codex", "@openai%2Fcodex"),
        ("harness", "@deepseek-ai%2Fdsh"),
    ] {
        let data: Value = c
            .get(format!("https://registry.npmjs.org/{package}"))
            .header("Accept", "application/vnd.npm.install-v1+json")
            .send()
            .await
            .map_err(network_error)?
            .error_for_status()
            .map_err(network_error)?
            .json()
            .await
            .map_err(network_error)?;
        let mut versions: Vec<String> = data["versions"]
            .as_object()
            .ok_or("npm 版本列表无效")?
            .iter()
            .filter(|(v, i)| re.is_match(v) && i.get("deprecated").is_none())
            .map(|(v, _)| v.clone())
            .collect();
        versions.sort_by_cached_key(|v| {
            let (main, pre) = v.split_once('-').unwrap_or((v, ""));
            let n: Vec<u64> = main.split('.').map(|s| s.parse().unwrap_or(0)).collect();
            (n, pre.is_empty(), pre.to_string())
        });
        versions.reverse();
        let latest = data["dist-tags"]["latest"].as_str().unwrap_or("");
        if let Some(i) = versions.iter().position(|v| v == latest) {
            let v = versions.remove(i);
            versions.insert(0, v);
        }
        versions.truncate(60);
        if versions.is_empty() {
            return Err("npm 未返回可安装版本".into());
        }
        result[tool] = json!({"latest":versions[0],"versions":versions});
    }
    Ok(result)
}
pub async fn install_runtime(
    core: &Core,
    app: &tauri::AppHandle,
    id: &str,
    p: &Profile,
    scope: &str,
) -> Result<Value, String> {
    let info = core.call(p, scope, "diagnose", json!({}), 60).await?;
    if info["managed_runtime"] == true {
        return Ok(json!({"message":"独立 Node.js 已安装"}));
    }
    if info["tool_inventory"]["runtime"]
        .as_str()
        .is_some_and(|v| !v.trim().is_empty())
    {
        return core
            .call(p, scope, "reuse_tools", json!({"tools":[]}), 100)
            .await;
    }
    let arch = match info["arch"].as_str() {
        Some("aarch64") => "arm64",
        Some("x86_64") => "x64",
        _ => return Err("仅支持 ARM64 / x86_64 Linux".into()),
    };
    if info["disk_free_mb"].as_u64().unwrap_or(0) < 1536 {
        return Err("板卡可用空间不足 1.5 GB".into());
    }
    let libc = info["libc"].as_str().unwrap_or("");
    let re = regex::Regex::new(r"glibc\s+(\d+)\.(\d+)").unwrap();
    let ok = re.captures(libc).is_some_and(|c| {
        (
            c[1].parse::<u32>().unwrap_or(0),
            c[2].parse::<u32>().unwrap_or(0),
        ) >= (2, 28)
    });
    if !ok {
        return Err("独立 Node.js 需要 glibc ≥ 2.28".into());
    }
    let c = client(p.proxy, p.proxy_port)?;
    let filename = format!("node-v24.11.0-linux-{arch}.tar.xz");
    let base = "https://nodejs.org/dist/v24.11.0/";
    tasks::progress(app, id, "读取 Node.js 官方校验信息");
    let sums = c
        .get(format!("{base}SHASUMS256.txt"))
        .send()
        .await
        .map_err(network_error)?
        .error_for_status()
        .map_err(network_error)?
        .text()
        .await
        .map_err(network_error)?;
    let checksum = sums
        .lines()
        .find_map(|line| {
            let mut p = line.split_whitespace();
            let hash = p.next()?;
            if p.next()? == filename {
                Some(hash.to_string())
            } else {
                None
            }
        })
        .ok_or("官方未返回对应 SHA-256")?;
    let archive = directory(core).join("downloads").join(&filename);
    tasks::progress(app, id, "下载并校验独立 Node.js，不替换板卡系统 Node");
    download(
        &c,
        &format!("{base}{filename}"),
        &archive,
        &checksum,
        512 * 1024 * 1024,
    )
    .await?;
    let remote = core.call(p, scope, "prepare", json!({}), 60).await?["path"]
        .as_str()
        .ok_or("远程目录无效")?
        .to_string()
        + "/node.tar.xz";
    tasks::progress(app, id, "通过 SSH 上传并安装运行环境");
    upload(p, &archive, &remote).await?;
    core.call(p, scope, "install_runtime", json!({"sha256":checksum}), 180)
        .await
}

struct Editor {
    exe: PathBuf,
    cli: PathBuf,
    commit: String,
}
async fn inspect(exe: PathBuf) -> Result<Editor, String> {
    if !exe.is_file()
        || exe
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase()
            != "code.exe"
    {
        return Err("请选择已安装 VS Code 的 Code.exe".into());
    }
    let parent = exe.parent().ok_or("编辑器路径无效")?;
    let mut choices = vec![parent.join("resources/app/out/cli.js")];
    for entry in fs::read_dir(parent).map_err(|e| e.to_string())?.flatten() {
        if entry.path().is_dir() {
            choices.push(entry.path().join("resources/app/out/cli.js"));
        }
    }
    for cli in choices.into_iter().filter(|p| p.is_file()) {
        let mut c = transport::command(exe.to_str().ok_or("编辑器路径编码无效")?);
        c.arg(&cli)
            .arg("--version")
            .env("ELECTRON_RUN_AS_NODE", "1");
        if let Ok(output) = transport::output(c, 25).await {
            if let Some(commit) = output
                .lines()
                .find(|s| s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit()))
            {
                return Ok(Editor {
                    exe,
                    cli,
                    commit: commit.to_string(),
                });
            }
        }
    }
    Err("无法识别 VS Code 版本".into())
}
fn find_code() -> Result<PathBuf, String> {
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        if dir.join("code.cmd").is_file() {
            let exe = dir.parent().unwrap_or(&dir).join("Code.exe");
            if exe.is_file() {
                return Ok(exe);
            }
        }
    }
    let mut candidates = vec![];
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local).join("Programs/Microsoft VS Code/Code.exe"));
    }
    if let Some(programs) = std::env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(programs).join("Microsoft VS Code/Code.exe"));
    }
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .ok_or("未找到 VS Code，请安装并加入 PATH 或手动选择 Code.exe".into())
}
fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let dest = target.join(entry.file_name());
        if ty.is_symlink() {
            return Err("编辑器程序目录含符号链接，请选择常规安装".into());
        }
        if ty.is_dir() {
            copy_tree(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
async fn editor(core: &Core, app: &tauri::AppHandle, id: &str) -> Result<Editor, String> {
    let root = directory(core).join("editor");
    let selected = root.join("selected.json");
    if !selected.exists() {
        pin(core, app, id, None).await?;
    }
    let data: Value = serde_json::from_slice(&fs::read(&selected).map_err(|e| e.to_string())?)
        .map_err(|_| "固定编辑器配置无效，请重新选择")?;
    let commit = data["commit"].as_str().ok_or("固定编辑器版本无效")?;
    if !regex::Regex::new("^[a-f0-9]{40}$")
        .unwrap()
        .is_match(commit)
    {
        return Err("固定编辑器版本无效".into());
    }
    let editor = inspect(root.join(commit).join("Code.exe")).await?;
    if editor.commit != commit {
        return Err("固定编辑器版本不匹配，请重新选择".into());
    }
    Ok(editor)
}
pub async fn pin(
    core: &Core,
    app: &tauri::AppHandle,
    id: &str,
    path: Option<&str>,
) -> Result<Value, String> {
    let source = inspect(match path.filter(|s| !s.is_empty()) {
        Some(path) => PathBuf::from(path),
        None => find_code()?,
    })
    .await?;
    let root = directory(core).join("editor");
    let target = root.join(&source.commit);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    if !target.exists() {
        tasks::progress(
            app,
            id,
            "从已有 VS Code 创建固定程序副本，不复制用户数据和凭据",
        );
        let from = source.exe.parent().unwrap().to_path_buf();
        let target_copy = target.clone();
        let relative = source
            .cli
            .strip_prefix(&from)
            .map_err(|e| e.to_string())?
            .to_path_buf();
        tokio::task::spawn_blocking(move || {
            let stage = target_copy.with_extension(store::new_id());
            fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
            let result: Result<(), String> = (|| {
                for entry in fs::read_dir(&from).map_err(|e| e.to_string())? {
                    let entry = entry.map_err(|e| e.to_string())?;
                    let name = entry.file_name().to_string_lossy().to_string();
                    let path = entry.path();
                    if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
                        if ["bin", "resources", "locales", "swiftshader"].contains(&name.as_str())
                            || relative
                                .components()
                                .next()
                                .is_some_and(|c| c.as_os_str() == entry.file_name())
                        {
                            copy_tree(&path, &stage.join(name))?;
                        }
                    } else if !name.to_lowercase().starts_with("unins")
                        && (["exe", "dll", "pak", "bin", "dat", "manifest", "xml"].contains(
                            &path
                                .extension()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .as_ref(),
                        ) || [
                            "LICENSE.txt",
                            "ThirdPartyNotices.txt",
                            "LICENSES.chromium.html",
                        ]
                        .contains(&name.as_str()))
                    {
                        fs::copy(&path, stage.join(name)).map_err(|e| e.to_string())?;
                    }
                }
                fs::rename(&stage, &target_copy).map_err(|e| e.to_string())?;
                Ok(())
            })();
            if result.is_err() {
                let _ = fs::remove_dir_all(stage);
            }
            result
        })
        .await
        .map_err(|e| e.to_string())??;
    }
    let pinned = inspect(target.join("Code.exe")).await?;
    if pinned.commit != source.commit {
        return Err("复制期间 VS Code 版本变化，未切换版本".into());
    }
    // Reuse only Remote SSH extension binaries, never their state or user profiles.
    let extension_target = target.join("managed-extensions");
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        fs::create_dir_all(&extension_target).map_err(|e| e.to_string())?;
        let home = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_default();
        let source_extensions = home.join(".vscode/extensions");
        if let Ok(entries) = fs::read_dir(source_extensions) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if (name.starts_with("ms-vscode-remote.remote-ssh-")
                    || name.starts_with("ms-vscode.remote-explorer-"))
                    && entry.path().join("package.json").is_file()
                    && !extension_target.join(&name).exists()
                {
                    copy_tree(&entry.path(), &extension_target.join(name))?;
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    store::atomic_write(
        &root.join("selected.json"),
        json!({"commit":pinned.commit}).to_string().as_bytes(),
    )?;
    Ok(json!({"message":format!("已固定编辑器 {}",pinned.commit),"commit":pinned.commit}))
}

fn editor_command(e: &Editor, data: &Path) -> tokio::process::Command {
    let mut c = transport::command(e.exe.to_str().unwrap());
    c.arg(&e.cli)
        .arg("--user-data-dir")
        .arg(data)
        .arg("--extensions-dir")
        .arg(e.exe.parent().unwrap().join("managed-extensions"))
        .env("ELECTRON_RUN_AS_NODE", "1");
    c
}
fn ssh_quote(path: &str) -> Result<String, String> {
    if path.contains(['\n', '\r', '"']) {
        return Err("SSH 配置路径含无效字符".into());
    }
    Ok(format!("\"{}\"", path.replace('\\', "/")))
}
pub async fn open(
    core: &Core,
    app: &tauri::AppHandle,
    id: &str,
    p: &Profile,
    scope: &str,
) -> Result<Value, String> {
    let data = directory(core)
        .join("vscode")
        .join(format!("{scope}-layout2"));
    fs::create_dir_all(data.join("User")).map_err(|e| e.to_string())?;
    let config = data.join("ssh_config");
    let alias = format!("edge-{scope}");
    let mut ssh=format!("Host {alias}\n  HostName {}\n  User {}\n  Port {}\n  StrictHostKeyChecking yes\n  BatchMode yes\n  RequestTTY no\n  ConnectTimeout 15\n  ServerAliveInterval 15\n  ServerAliveCountMax 3\n",p.host,p.user,p.port);
    if !p.identity.is_empty() {
        ssh += &format!(
            "  IdentityFile {}\n  IdentitiesOnly yes\n",
            ssh_quote(&p.identity)?
        );
    }
    store::atomic_write(&config, ssh.as_bytes())?;
    tasks::progress(app, id, "检查 SSH 和板卡运行条件");
    let info = core.call(p, scope, "diagnose", json!({}), 60).await?;
    let mut probe = transport::command("ssh");
    probe.arg("-F").arg(&config).args(["-T", &alias, "true"]);
    transport::output(probe, 30).await?;
    let e = editor(core, app, id).await?;
    let proxy = core.route(p, "codex").await?;
    tasks::progress(app, id, "准备此环境独立的 VS Code Server");
    let mut server = core
        .call(
            p,
            scope,
            "vscode_server",
            json!({"commit":e.commit,"proxy":proxy}),
            180,
        )
        .await?;
    if server["ready"] != true {
        if server["free_bytes"].as_u64().unwrap_or(0) < 1024 * 1024 * 1024 {
            return Err("板卡需要至少 1 GB 可用空间".into());
        }
        let arch = match server["arch"].as_str() {
            Some("aarch64" | "arm64") => "arm64",
            Some("x86_64") => "x64",
            _ => return Err("VS Code Server 仅支持 ARM64 / x86_64".into()),
        };
        let (archive, checksum) = download_server(core, app, id, p, &e.commit, arch).await?;
        let upload_id = store::new_id();
        let remote = format!(
            "{}/{}-{upload_id}.tar.gz",
            server["path"].as_str().ok_or("服务端目录无效")?,
            e.commit
        );
        tasks::progress(app, id, "上传已校验服务端并在板卡解压验证");
        upload(p, &archive, &remote).await?;
        server=core.call(p,scope,"vscode_server",json!({"commit":e.commit,"proxy":proxy,"install":true,"upload_id":upload_id,"sha256":checksum}),180).await?;
        if server["ready"] != true {
            return Err("VS Code 服务端尚未就绪".into());
        }
    }
    let server_path = server["path"].as_str().ok_or("服务端路径无效")?;
    // Remote SSH adds .vscode-server itself; use the parent directory.
    let parent = server_path
        .rsplit_once('/')
        .map(|v| v.0)
        .ok_or("服务端父目录无效")?;
    let mut settings = json!({"remote.SSH.configFile":config,"remote.SSH.localServerDownload":"auto","remote.SSH.path":ssh_executable(),"remote.SSH.useFlock":info["flock"],"remote.SSH.remotePlatform":{alias.clone():"linux"},"remote.SSH.useLocalServer":false,"remote.SSH.useExecServer":false,"remote.SSH.showLoginTerminal":true,"remote.SSH.connectTimeout":30,"remote.SSH.serverInstallPath":{alias.clone():parent},"update.mode":"none","extensions.autoUpdate":false,"extensions.autoCheckUpdates":false,"http.proxy":if p.proxy{format!("http://127.0.0.1:{}",p.proxy_port)}else{String::new()},"remote.SSH.httpProxy":{alias.clone():proxy},"remote.SSH.httpsProxy":{alias.clone():proxy}});
    tasks::progress(app, id, "检查本机 Remote SSH 扩展");
    let mut listed = editor_command(&e, &data);
    listed.arg("--list-extensions");
    let extensions = transport::output(listed, 40).await?;
    if !extensions
        .lines()
        .any(|s| s.trim().eq_ignore_ascii_case("ms-vscode-remote.remote-ssh"))
    {
        let mut install = editor_command(&e, &data);
        install.args(["--install-extension", "ms-vscode-remote.remote-ssh"]);
        transport::output(install, 180).await?;
    }
    if p.codex_auth == "chatgpt"
        || info["codex_configured"] == true
        || !tasks::api(core, p).await?["key"]
            .as_str()
            .unwrap_or("")
            .is_empty()
    {
        tasks::progress(app, id, "准备远程 Codex 扩展与当前环境认证");
        let extension = core
            .call(
                p,
                scope,
                "prepare_ide",
                json!({"commit":e.commit,"proxy":proxy}),
                300,
            )
            .await?;
        if extension["ready"] != true {
            return Err("远程扩展尚未验证就绪，未同步凭据".into());
        }
        let ide = tasks::configure(core, p, scope, true).await?;
        settings["chatgpt.cliExecutable"] = ide["cli"].clone();
        settings["chatgpt.openOnStartup"] = json!(true);
        settings["chatgpt.localeOverride"] = json!("zh-CN");
    }
    let settings_path = data.join("User/settings.json");
    patch_settings(&settings_path, &settings)?;
    tasks::progress(app, id, "准备完成，正在打开独立远程窗口");
    let mut launch = editor_command(&e, &data);
    launch.args([
        "--reuse-window",
        "--remote",
        &format!("ssh-remote+{alias}"),
        &p.project,
    ]);
    transport::output(launch, 30).await?;
    Ok(json!({"message":"已发送 VS Code 打开请求，实际连接请查看编辑器或连接诊断"}))
}
fn ssh_executable() -> String {
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        let p = dir.join("ssh.exe");
        if p.is_file() {
            return p.to_string_lossy().into_owned();
        }
    }
    "ssh".into()
}
fn patch_settings(path: &Path, changes: &Value) -> Result<(), String> {
    // The file belongs to this application, but preserve existing JSONC user preferences.
    let source = if path.exists() {
        fs::read_to_string(path).map_err(|e| e.to_string())?
    } else {
        "{}".into()
    };
    let mut value: Value = json5::from_str(&source)
        .map_err(|_| "独立 VS Code 设置无法解析，原文件保留，请检查 settings.json")?;
    let obj = value.as_object_mut().ok_or("编辑器设置必须为 JSON 对象")?;
    for (k, v) in changes.as_object().unwrap() {
        obj.insert(k.clone(), v.clone());
    }
    if path.exists() {
        let backup = path.with_extension("pre-tauri.jsonc");
        if !backup.exists() {
            fs::copy(path, backup).map_err(|e| e.to_string())?;
        }
    }
    store::atomic_write(
        path,
        &serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
    )
}
async fn download_server(
    core: &Core,
    app: &tauri::AppHandle,
    id: &str,
    p: &Profile,
    commit: &str,
    arch: &str,
) -> Result<(PathBuf, String), String> {
    let cache = directory(core).join("downloads/vscode");
    fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let archive = cache.join(format!("{commit}-{arch}.tar.gz"));
    let marker = archive.with_extension("tar.json");
    if let Ok(text) = fs::read_to_string(&marker) {
        if let Ok(meta) = serde_json::from_str::<Value>(&text) {
            if archive.is_file() && hash(&archive).await? == meta["sha256"].as_str().unwrap_or("") {
                return Ok((archive, meta["sha256"].as_str().unwrap().into()));
            }
        }
    }
    let c = client(p.proxy, p.proxy_port)?;
    let url =
        format!("https://update.code.visualstudio.com/commit:{commit}/server-linux-{arch}/stable");
    tasks::progress(app, id, "读取微软官方服务端大小和 SHA-256");
    let response = c
        .head(&url)
        .send()
        .await
        .map_err(network_error)?
        .error_for_status()
        .map_err(network_error)?;
    if response.url().scheme() != "https" {
        return Err("服务端下载地址不是 HTTPS".into());
    }
    let checksum = response
        .headers()
        .get("x-sha256")
        .and_then(|v| v.to_str().ok())
        .ok_or("官方未返回 SHA-256，已停止安装")?
        .to_lowercase();
    if !regex::Regex::new("^[a-f0-9]{64}$")
        .unwrap()
        .is_match(&checksum)
    {
        return Err("官方 SHA-256 格式无效".into());
    }
    let size = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .ok_or("官方未返回文件大小")?;
    if size == 0 || size > 1024 * 1024 * 1024 {
        return Err("服务端大小异常".into());
    }
    let final_url = response.url().to_string();
    drop(response);
    tasks::progress(app, id, "下载并校验匹配版本的 VS Code Server");
    download(&c, &final_url, &archive, &checksum, size).await?;
    store::atomic_write(
        &marker,
        json!({"sha256":checksum,"size":size})
            .to_string()
            .as_bytes(),
    )?;
    Ok((archive, checksum))
}
pub fn diagnostics(core: &Core, scope: &str) -> Result<Value, String> {
    let logs = directory(core)
        .join("vscode")
        .join(format!("{scope}-layout2"))
        .join("logs");
    let mut files = vec![];
    fn visit(path: &Path, files: &mut Vec<PathBuf>, depth: u8) {
        if depth > 8 {
            return;
        }
        if let Ok(entries) = fs::read_dir(path) {
            for e in entries.flatten() {
                if e.path().is_dir() {
                    visit(&e.path(), files, depth + 1);
                } else if e.file_name().to_string_lossy().contains("Remote - SSH") {
                    files.push(e.path());
                }
            }
        }
    }
    visit(&logs, &mut files, 0);
    files.sort_by_key(|p| p.metadata().and_then(|m| m.modified()).ok());
    if let Some(file) = files.last() {
        let text = fs::read_to_string(file).map_err(|e| e.to_string())?;
        let connected = text.contains("Resolved ssh-remote");
        let reused =
            text.contains("Found existing installation") || text.contains("didLocalDownload==0");
        return Ok(
            json!({"message":format!("{}；{}",if connected{"日志记录远程连接已解析"}else{"日志尚未确认远程连接成功"},if reused{"复用已有服务端"}else{"请在编辑器检查完整日志"}),"log_file":file}),
        );
    }
    Ok(json!({"message":"尚未找到 Remote SSH 日志，请先打开编辑器"}))
}
pub async fn import_server(
    core: &Core,
    p: &Profile,
    scope: &str,
    path: &str,
) -> Result<Value, String> {
    let selected = directory(core).join("editor/selected.json");
    let e: Value = serde_json::from_slice(&fs::read(selected).map_err(|_| "请先固定编辑器版本")?)
        .map_err(|_| "编辑器配置无效")?;
    let commit = e["commit"].as_str().ok_or("编辑器版本无效")?;
    if !regex::Regex::new("^[a-f0-9]{40}$")
        .unwrap()
        .is_match(commit)
    {
        return Err("编辑器版本无效".into());
    }
    let info = core.call(p, scope, "diagnose", json!({}), 60).await?;
    let arch = match info["arch"].as_str() {
        Some("aarch64") => "arm64",
        Some("x86_64") => "x64",
        _ => return Err("架构不支持".into()),
    };
    let cache = directory(core).join("downloads/vscode");
    fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let target = cache.join(format!("{commit}-{arch}.tar.gz"));
    let source = Path::new(path);
    let metadata = tokio::fs::metadata(source)
        .await
        .map_err(|_| "无法读取安装包")?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > 1024 * 1024 * 1024 {
        return Err("安装包必须是 1 GB 以内的非空文件".into());
    }
    if source.canonicalize().map_err(|e| e.to_string())?
        != target.canonicalize().unwrap_or_default()
    {
        if target.exists() && hash(&target).await? != hash(source).await? {
            return Err("缓存中已有不同文件，未覆盖".into());
        }
        tokio::fs::copy(source, &target)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(json!({"message":"已导入安装包，打开 VS Code 时将与官方 SHA-256 对比后安装"}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settings_preserve_values_and_backup() {
        let dir = std::env::temp_dir().join(store::new_id());
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("settings.json");
        fs::write(&p, "{ // hi\n\"existing\":true,\n}").unwrap();
        patch_settings(&p, &json!({"new":42})).unwrap();
        let v: Value = serde_json::from_slice(&fs::read(&p).unwrap()).unwrap();
        assert_eq!(v["existing"], true);
        assert_eq!(v["new"], 42);
        assert!(p.with_extension("pre-tauri.jsonc").exists());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn ssh_config_rejects_newline() {
        assert!(ssh_quote("x\nHost *").is_err());
    }
}

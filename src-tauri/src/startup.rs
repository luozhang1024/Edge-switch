use std::{fs::OpenOptions, io::Write, path::PathBuf};

pub fn report(error: &str) {
    let directory = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("EdgeSSHAI");
    let _ = std::fs::create_dir_all(&directory);
    let path = directory.join("startup.log");
    if let Ok(mut log) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(
            log,
            "\nEdge Switch {} | {:?}\n{}",
            env!("CARGO_PKG_VERSION"),
            std::time::SystemTime::now(),
            error
        );
    }
    let message = format!("Edge Switch 无法启动 / Could not start\n\n{error}\n\n日志 / Log: {}\n\n请将 ZIP 完整解压后运行。若未安装 Microsoft Edge WebView2，请运行便携包中的 Launch-EdgeSwitch.cmd，或使用安装版。\nExtract the entire ZIP first. Run Launch-EdgeSwitch.cmd to check WebView2, or use the installer.", path.display());
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
        let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
        let title: Vec<u16> = "Edge Switch".encode_utf16().chain(Some(0)).collect();
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                text.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR,
            );
        }
    }
    #[cfg(not(windows))]
    eprintln!("{message}");
}

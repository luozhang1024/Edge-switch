//! Launch URLs with Windows' registered default browser, without Explorer URL parsing.
pub fn open(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| "网页地址无效")?;
    if !["https", "http"].contains(&parsed.scheme())
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("网页地址无效".into());
    }
    #[cfg(windows)]
    {
        let verb: Vec<u16> = "open\0".encode_utf16().collect();
        let target: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
        let result = unsafe {
            windows_sys::Win32::UI::Shell::ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if result as isize <= 32 {
            return Err("无法打开默认浏览器，请检查 Windows 的 HTTP/HTTPS 默认应用".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("当前版本仅支持 Windows".into())
    }
}

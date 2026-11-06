use base64::{engine::general_purpose::STANDARD, Engine};

#[cfg(windows)]
fn crypt(input: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let source = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_ptr() as *mut u8,
    };
    let mut target = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        if decrypt {
            CryptUnprotectData(
                &source,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut target,
            )
        } else {
            CryptProtectData(
                &source,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut target,
            )
        }
    };
    if ok == 0 {
        return Err("Windows 凭据加解密失败，请使用原 Windows 账号或重新输入凭据".into());
    }
    let result =
        unsafe { std::slice::from_raw_parts(target.pbData, target.cbData as usize).to_vec() };
    unsafe {
        LocalFree(target.pbData as *mut _);
    }
    Ok(result)
}

#[cfg(not(windows))]
fn crypt(_: &[u8], _: bool) -> Result<Vec<u8>, String> {
    Err("此版本的凭据持久化需要 Windows DPAPI".into())
}

pub fn protect(text: &str) -> Result<String, String> {
    Ok(STANDARD.encode(crypt(text.as_bytes(), false)?))
}

pub fn unprotect(text: &str) -> Result<String, String> {
    String::from_utf8(crypt(
        &STANDARD.decode(text).map_err(|_| "凭据编码无效")?,
        true,
    )?)
    .map_err(|_| "凭据内容编码无效".into())
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn dpapi_matches_legacy_base64_format() {
        let text = "测试-key-123";
        let encrypted = super::protect(text).unwrap();
        assert!(!encrypted.contains(text));
        assert_eq!(super::unprotect(&encrypted).unwrap(), text);
    }
    #[test]
    fn python_legacy_and_rust_dpapi_are_interoperable() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap();
        let output = std::process::Command::new("python")
            .current_dir(root)
            .args([
                "-c",
                "from workbench.core import protect; print(protect('legacy-test-value'))",
            ])
            .output()
            .unwrap();
        assert!(output.status.success());
        let encrypted = String::from_utf8(output.stdout).unwrap();
        assert_eq!(
            super::unprotect(encrypted.trim()).unwrap(),
            "legacy-test-value"
        );
        use std::io::Write;
        let mut child=std::process::Command::new("python").current_dir(root).args(["-c","import sys; from workbench.core import protect; print(protect(sys.stdin.read(), decrypt=True))"]).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).spawn().unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(super::protect("rust-test-value").unwrap().as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).unwrap().trim(),
            "rust-test-value"
        );
    }
}

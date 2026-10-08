use super::*;
use std::{
    fs::File,
    io::{Read, Write},
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle},
    },
    path::{Path, PathBuf},
    ptr::{null, null_mut},
};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, Cryptography::*, *},
    Storage::FileSystem::*,
    System::Threading::*,
};

fn failure() -> WireError {
    WireError::new(ErrorCode::AuthenticationFailed)
}
fn wide(s: impl AsRef<std::ffi::OsStr>) -> Result<Vec<u16>, WireError> {
    let mut s: Vec<u16> = s.as_ref().encode_wide().collect();
    if s.contains(&0) {
        return Err(failure());
    }
    s.push(0);
    Ok(s)
}
struct Local(*mut std::ffi::c_void);
impl Drop for Local {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                LocalFree(self.0);
            }
        }
    }
}
struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
struct Security {
    descriptor: Local,
    sid: Vec<u32>,
}
impl Security {
    fn current() -> Result<Self, WireError> {
        unsafe {
            let mut raw = null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw) == 0 {
                return Err(failure());
            }
            let token = Handle(raw);
            let mut length = 0;
            GetTokenInformation(token.0, TokenUser, null_mut(), 0, &mut length);
            if length == 0 || length > 65536 {
                return Err(failure());
            }
            let mut buffer = vec![0usize; (length as usize).div_ceil(size_of::<usize>())];
            if GetTokenInformation(
                token.0,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                length,
                &mut length,
            ) == 0
            {
                return Err(failure());
            }
            let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
            let sid_len = GetLengthSid(user.User.Sid);
            let mut sid = vec![0u32; (sid_len as usize).div_ceil(4)];
            if CopySid(sid_len, sid.as_mut_ptr().cast(), user.User.Sid) == 0 {
                return Err(failure());
            }
            let mut text = null_mut();
            if ConvertSidToStringSidW(sid.as_ptr().cast_mut().cast(), &mut text) == 0 {
                return Err(failure());
            }
            let text_owner = Local(text.cast());
            let mut n = 0;
            while *text.add(n) != 0 {
                n += 1;
            }
            let sid_text =
                String::from_utf16(std::slice::from_raw_parts(text, n)).map_err(|_| failure())?;
            drop(text_owner);
            let sddl = wide(format!("O:{sid_text}D:P(A;OICI;FA;;;{sid_text})"))?;
            let mut sd = null_mut();
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut sd,
                null_mut(),
            ) == 0
            {
                return Err(failure());
            }
            Ok(Self {
                descriptor: Local(sd),
                sid,
            })
        }
    }
    fn attributes(&self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.descriptor.0,
            bInheritHandle: 0,
        }
    }
    fn validate(&self, file: &File) -> Result<(), WireError> {
        unsafe {
            let mut owner = null_mut();
            let mut acl = null_mut();
            let mut sd = null_mut();
            if GetSecurityInfo(
                file.as_raw_handle().cast(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                &mut owner,
                null_mut(),
                &mut acl,
                null_mut(),
                &mut sd,
            ) != 0
            {
                return Err(failure());
            }
            let _sd = Local(sd);
            let sid = self.sid.as_ptr().cast_mut().cast();
            if owner.is_null() || EqualSid(owner, sid) == 0 || acl.is_null() {
                return Err(failure());
            }
            let mut control = 0;
            let mut revision = 0;
            if GetSecurityDescriptorControl(sd, &mut control, &mut revision) == 0
                || control & SE_DACL_PROTECTED == 0
                || (*acl).AceCount != 1
            {
                return Err(failure());
            }
            let mut ace = null_mut();
            if GetAce(acl, 0, &mut ace) == 0 {
                return Err(failure());
            }
            let allow = &*ace.cast::<ACCESS_ALLOWED_ACE>();
            // ACCESS_ALLOWED_ACE_TYPE is zero in the Windows ACE_HEADER ABI.
            if allow.Header.AceType != 0
                || u32::from(allow.Header.AceFlags) & INHERIT_ONLY_ACE != 0
                || EqualSid((&allow.SidStart as *const u32).cast_mut().cast(), sid) == 0
                || allow.Mask & FILE_ALL_ACCESS != FILE_ALL_ACCESS
            {
                return Err(failure());
            }
            Ok(())
        }
    }
    fn open(
        &self,
        path: &Path,
        access: u32,
        share: u32,
        creation: u32,
        directory: bool,
    ) -> Result<File, WireError> {
        check_path(path)?;
        let name = wide(path)?;
        let attrs = self.attributes();
        let flags = FILE_FLAG_OPEN_REPARSE_POINT
            | if directory {
                FILE_FLAG_BACKUP_SEMANTICS
            } else {
                0
            };
        let handle = unsafe {
            CreateFileW(
                name.as_ptr(),
                access | READ_CONTROL,
                share,
                &attrs,
                creation,
                flags,
                null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            let code = unsafe { GetLastError() };
            return Err(
                if code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND {
                    WireError::new(ErrorCode::AppOffline)
                } else {
                    failure()
                },
            );
        }
        let file = unsafe { File::from_raw_handle(handle) };
        let mut info = unsafe { std::mem::zeroed::<BY_HANDLE_FILE_INFORMATION>() };
        if unsafe { GetFileInformationByHandle(handle, &mut info) } == 0
            || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
        {
            return Err(failure());
        }
        self.validate(&file)?;
        Ok(file)
    }
    fn directory(&self, path: &Path) -> Result<File, WireError> {
        check_path(path)?;
        let name = wide(path)?;
        let attrs = self.attributes();
        if unsafe { CreateDirectoryW(name.as_ptr(), &attrs) } == 0
            && unsafe { GetLastError() } != ERROR_ALREADY_EXISTS
        {
            return Err(failure());
        }
        self.open(
            path,
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            OPEN_EXISTING,
            true,
        )
    }
}
fn check_path(path: &Path) -> Result<(), WireError> {
    use std::os::windows::fs::MetadataExt;
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(failure());
    }
    for ancestor in path.ancestors() {
        match std::fs::symlink_metadata(ancestor) {
            Ok(m) if m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 => {
                return Err(failure());
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(failure()),
        }
    }
    Ok(())
}
fn crypt(bytes: &[u8], protect: bool) -> Result<Zeroizing<Vec<u8>>, WireError> {
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: bytes.len().try_into().map_err(|_| failure())?,
            pbData: bytes.as_ptr().cast_mut(),
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };
        let success = if protect {
            CryptProtectData(
                &input,
                null(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                null_mut(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if success == 0 {
            return Err(failure());
        }
        let _allocated = Local(output.pbData.cast());
        let data = std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize);
        let result = Zeroizing::new(data.to_vec());
        data.zeroize();
        Ok(result)
    }
}
pub struct EndpointLease {
    dir: PathBuf,
    discovery: Discovery,
    _lock: File,
    _directory: File,
    first: Option<NamedPipeServer>,
}
impl EndpointLease {
    pub fn publish(dir: &Path, app: WireId) -> Result<Self, WireError> {
        let security = Security::current()?;
        let directory = security.directory(dir)?;
        let lock = security.open(
            &dir.join("app.lock"),
            GENERIC_READ | GENERIC_WRITE,
            0,
            OPEN_ALWAYS,
            false,
        )?;
        let discovery = Discovery {
            contract_version: 2,
            app_instance_id: app,
            pipe_name: format!("\\\\.\\pipe\\baton-rust-v2-{:032x}", app.as_u128()),
            secret: Secret::generate()?,
        };
        let first = pipe(&discovery.pipe_name, true)?;
        let mut lease = Self {
            dir: dir.to_owned(),
            discovery,
            _lock: lock,
            _directory: directory,
            first: Some(first),
        };
        lease.publish_file(&security)?;
        Ok(lease)
    }
    fn publish_file(&mut self, security: &Security) -> Result<(), WireError> {
        let target = self.dir.join("endpoint.bin");
        if target.exists() {
            security.open(&target, GENERIC_READ, FILE_SHARE_READ, OPEN_EXISTING, false)?;
        }
        let temporary = self.dir.join(format!(
            "{:032x}.tmp",
            self.discovery.app_instance_id.as_u128()
        ));
        let result = (|| {
            let mut file = security.open(&temporary, GENERIC_WRITE, 0, CREATE_NEW, false)?;
            let clear = Zeroizing::new(serde_json::to_vec(&self.discovery).map_err(|_| failure())?);
            let encrypted = crypt(&clear, true)?;
            file.write_all(&encrypted).map_err(|_| failure())?;
            file.sync_all().map_err(|_| failure())?;
            drop(file);
            let from = wide(&temporary)?;
            let to = wide(&target)?;
            if unsafe {
                MoveFileExW(
                    from.as_ptr(),
                    to.as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            } == 0
            {
                return Err(failure());
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(temporary);
        }
        result
    }
    pub fn discovery(&self) -> &Discovery {
        &self.discovery
    }
    pub fn take_first_pipe(&mut self) -> Option<NamedPipeServer> {
        self.first.take()
    }
    pub fn next_pipe(&self) -> Result<NamedPipeServer, WireError> {
        pipe(&self.discovery.pipe_name, false)
    }
}
impl Drop for EndpointLease {
    fn drop(&mut self) {
        if load_endpoint(&self.dir)
            .is_ok_and(|d| d.app_instance_id == self.discovery.app_instance_id)
        {
            let _ = std::fs::remove_file(self.dir.join("endpoint.bin"));
        }
    }
}
fn pipe(name: &str, first: bool) -> Result<NamedPipeServer, WireError> {
    let security = Security::current()?;
    let mut attrs = security.attributes();
    unsafe {
        ServerOptions::new()
            .first_pipe_instance(first)
            .reject_remote_clients(true)
            .create_with_security_attributes_raw(
                name,
                (&mut attrs as *mut SECURITY_ATTRIBUTES).cast(),
            )
    }
    .map_err(|_| failure())
}
pub fn load_endpoint(dir: &Path) -> Result<Discovery, WireError> {
    let security = Security::current()?;
    let _directory = security.open(
        dir,
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        OPEN_EXISTING,
        true,
    )?;
    let file = security.open(
        &dir.join("endpoint.bin"),
        GENERIC_READ,
        FILE_SHARE_READ,
        OPEN_EXISTING,
        false,
    )?;
    if file.metadata().map_err(|_| failure())?.len() > 16384 {
        return Err(failure());
    }
    let mut bytes = Zeroizing::new(Vec::new());
    file.take(16385)
        .read_to_end(&mut bytes)
        .map_err(|_| failure())?;
    if bytes.len() > 16384 {
        return Err(failure());
    }
    let clear = crypt(&bytes, false)?;
    let value: Discovery = serde_json::from_slice(&clear).map_err(|_| failure())?;
    if value.contract_version != 2 {
        return Err(WireError::new(ErrorCode::ProtocolMismatch));
    }
    if value.pipe_name
        != format!(
            "\\\\.\\pipe\\baton-rust-v2-{:032x}",
            value.app_instance_id.as_u128()
        )
    {
        return Err(failure());
    }
    Ok(value)
}
/// Create only the two application-owned directories, with a protected DACL
/// at creation. Existing directories must already satisfy the same policy.
pub fn prepare_endpoint_dir(local_app_data: &Path) -> Result<PathBuf, WireError> {
    let security = Security::current()?;
    let root = local_app_data.join("BatonRust");
    let _root_handle = security.directory(&root)?;
    let dir = root.join("v2");
    let _dir_handle = security.directory(&dir)?;
    Ok(dir)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn test_dir() -> PathBuf {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../artifacts/phase3-endpoint");
        std::fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap().join(format!(
            "unit-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    #[test]
    fn acl_access_check_accepts_owner_and_rejects_synthetic_foreign_sid() {
        unsafe {
            let security = Security::current().unwrap();
            let mut manager = null_mut();
            assert_ne!(
                AuthzInitializeResourceManager(
                    AUTHZ_RM_FLAG_NO_AUDIT,
                    None,
                    None,
                    None,
                    null(),
                    &mut manager
                ),
                0
            );
            let mut foreign = null_mut();
            assert_ne!(
                ConvertStringSidToSidW(
                    wide("S-1-5-21-1-2-3-12345").unwrap().as_ptr(),
                    &mut foreign
                ),
                0
            );
            let _foreign = Local(foreign);
            for (sid, allowed) in [
                (security.sid.as_ptr().cast_mut().cast(), true),
                (foreign, false),
            ] {
                let mut context = null_mut();
                assert_ne!(
                    AuthzInitializeContextFromSid(
                        AUTHZ_SKIP_TOKEN_GROUPS,
                        sid,
                        manager,
                        null(),
                        LUID {
                            LowPart: 0,
                            HighPart: 0
                        },
                        null(),
                        &mut context
                    ),
                    0
                );
                let request = AUTHZ_ACCESS_REQUEST {
                    DesiredAccess: FILE_READ_DATA | FILE_WRITE_DATA,
                    ..std::mem::zeroed()
                };
                let mut granted = 0;
                let mut error = 0;
                let mut reply = AUTHZ_ACCESS_REPLY {
                    ResultListLength: 1,
                    GrantedAccessMask: &mut granted,
                    SaclEvaluationResults: null_mut(),
                    Error: &mut error,
                };
                assert_ne!(
                    AuthzAccessCheck(
                        0,
                        context,
                        &request,
                        null_mut(),
                        security.descriptor.0,
                        null(),
                        0,
                        &mut reply,
                        null_mut()
                    ),
                    0
                );
                assert_eq!(error == 0, allowed);
                assert_eq!(granted == request.DesiredAccess, allowed);
                AuthzFreeContext(context);
            }
            AuthzFreeResourceManager(manager);
        }
    }
    #[tokio::test]
    async fn old_lease_does_not_remove_another_instance_discovery() {
        let dir = test_dir();
        let lease = EndpointLease::publish(&dir, WireId::from_u128(810)).unwrap();
        let replacement = Discovery {
            contract_version: 2,
            app_instance_id: WireId::from_u128(811),
            pipe_name: format!("\\\\.\\pipe\\baton-rust-v2-{:032x}", 811),
            secret: Secret::generate().unwrap(),
        };
        let clear = Zeroizing::new(serde_json::to_vec(&replacement).unwrap());
        std::fs::write(dir.join("endpoint.bin"), crypt(&clear, true).unwrap()).unwrap();
        drop(lease);
        assert_eq!(
            load_endpoint(&dir).unwrap().app_instance_id,
            replacement.app_instance_id
        );
    }
    #[tokio::test]
    async fn loose_directory_acl_is_rejected() {
        unsafe {
            let dir = test_dir();
            let security = Security::current().unwrap();
            let file = security.directory(&dir).unwrap();
            let mut sd = null_mut();
            assert_ne!(
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    wide("D:P(A;OICI;FA;;;WD)").unwrap().as_ptr(),
                    1,
                    &mut sd,
                    null_mut()
                ),
                0
            );
            let _sd = Local(sd);
            let mut acl = null_mut();
            let mut present = 0;
            let mut defaulted = 0;
            assert_ne!(
                GetSecurityDescriptorDacl(sd, &mut present, &mut acl, &mut defaulted),
                0
            );
            // Reopen only this newly-created fixture with WRITE_DAC, never a user directory.
            let handle = CreateFileW(
                wide(&dir).unwrap().as_ptr(),
                GENERIC_READ | WRITE_DAC,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                null_mut(),
            );
            assert_ne!(handle, INVALID_HANDLE_VALUE);
            let handle = Handle(handle);
            assert_eq!(
                SetSecurityInfo(
                    handle.0,
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                    null_mut(),
                    null_mut(),
                    acl,
                    null()
                ),
                0
            );
            assert!(security.validate(&file).is_err());
            assert!(EndpointLease::publish(&dir, WireId::from_u128(900)).is_err());
            let mut good_acl = null_mut();
            GetSecurityDescriptorDacl(
                security.descriptor.0,
                &mut present,
                &mut good_acl,
                &mut defaulted,
            );
            assert_eq!(
                SetSecurityInfo(
                    handle.0,
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                    null_mut(),
                    null_mut(),
                    good_acl,
                    null()
                ),
                0
            );
        }
    }
    #[test]
    fn reparse_directory_is_rejected_before_opening_endpoint() {
        let root = test_dir();
        std::fs::create_dir(&root).unwrap();
        let target = root.join("target");
        std::fs::create_dir(&target).unwrap();
        let link = root.join("link");
        std::os::windows::fs::symlink_dir(&target, &link)
            .expect("fixture symlink requires Windows developer mode or privilege");
        assert!(check_path(&link.join("endpoint.bin")).is_err());
    }
    #[tokio::test]
    async fn protected_creation_steps() {
        let security = Security::current().expect("current security descriptor");
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../artifacts/phase3-endpoint");
        std::fs::create_dir_all(&root).unwrap();
        let dir = root.canonicalize().unwrap().join(format!(
            "unit-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        check_path(&dir).expect("path");
        let _directory = security.directory(&dir).expect("protected directory");
        let _lock = security
            .open(
                &dir.join("app.lock"),
                GENERIC_READ | GENERIC_WRITE,
                0,
                OPEN_ALWAYS,
                false,
            )
            .expect("lock");
        let _pipe = pipe(
            &format!("\\\\.\\pipe\\baton-test-{}", std::process::id()),
            true,
        )
        .expect("pipe");
        let bytes = crypt(b"test", true).expect("protect");
        assert_eq!(&**crypt(&bytes, false).expect("unprotect"), b"test");
    }
}

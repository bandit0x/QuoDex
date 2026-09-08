use std::{
    ffi::OsStr,
    fs,
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
};

#[cfg(test)]
use std::{ffi::OsString, os::windows::ffi::OsStringExt};

use windows::{
    core::{Interface, PCWSTR},
    Win32::{
        Foundation::RPC_E_CHANGED_MODE,
        Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH},
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        },
        UI::Shell::{IShellLinkW, ShellLink},
    },
};

#[cfg(not(debug_assertions))]
use windows::Win32::{
    System::Com::CoTaskMemFree,
    UI::Shell::{FOLDERID_Desktop, SHGetKnownFolderPath, KF_FLAG_DEFAULT},
};

const SHORTCUT_FILE_NAME: &str = "QuoDex.lnk";
const PENDING_SHORTCUT_FILE_NAME: &str = "QuoDex.pending.lnk";

struct ComApartment {
    should_uninitialize: bool,
}

impl ComApartment {
    fn initialize() -> windows::core::Result<Self> {
        let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if result.is_ok() {
            return Ok(Self {
                should_uninitialize: true,
            });
        }
        if result == RPC_E_CHANGED_MODE {
            return Ok(Self {
                should_uninitialize: false,
            });
        }
        Err(result.into())
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.should_uninitialize {
            unsafe { CoUninitialize() };
        }
    }
}

fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(not(debug_assertions))]
fn desktop_directory() -> windows::core::Result<PathBuf> {
    unsafe {
        let raw_path = SHGetKnownFolderPath(&FOLDERID_Desktop, KF_FLAG_DEFAULT, None)?;
        let result = raw_path.to_string().map(PathBuf::from);
        CoTaskMemFree(Some(raw_path.0.cast()));
        Ok(result?)
    }
}

fn save_shortcut(executable: &Path, shortcut: &Path) -> windows::core::Result<()> {
    let executable_wide = wide(executable.as_os_str());
    let working_directory = executable.parent().unwrap_or_else(|| Path::new("."));
    let working_directory_wide = wide(working_directory.as_os_str());
    let shortcut_wide = wide(shortcut.as_os_str());

    unsafe {
        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        shell_link.SetPath(PCWSTR(executable_wide.as_ptr()))?;
        shell_link.SetWorkingDirectory(PCWSTR(working_directory_wide.as_ptr()))?;
        shell_link.SetIconLocation(PCWSTR(executable_wide.as_ptr()), 0)?;
        shell_link.SetDescription(windows::core::w!("Open QuoDex"))?;

        let persist_file: IPersistFile = shell_link.cast()?;
        persist_file.Save(PCWSTR(shortcut_wide.as_ptr()), true)
    }
}

fn replace_shortcut(executable: &Path, shortcut: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let _apartment = ComApartment::initialize()?;
    let pending_shortcut = shortcut.with_file_name(PENDING_SHORTCUT_FILE_NAME);

    if pending_shortcut.exists() {
        fs::remove_file(&pending_shortcut)?;
    }
    save_shortcut(executable, &pending_shortcut)?;
    let pending_shortcut_wide = wide(pending_shortcut.as_os_str());
    let shortcut_wide = wide(shortcut.as_os_str());
    unsafe {
        MoveFileExW(
            PCWSTR(pending_shortcut_wide.as_ptr()),
            PCWSTR(shortcut_wide.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )?;
    }
    Ok(())
}

#[cfg(not(debug_assertions))]
pub fn replace_desktop_shortcut() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let executable = std::env::current_exe()?;
    let shortcut = desktop_directory()?.join(SHORTCUT_FILE_NAME);
    replace_shortcut(&executable, &shortcut)?;
    Ok(shortcut)
}

#[cfg(test)]
fn read_shortcut_target(shortcut: &Path) -> windows::core::Result<PathBuf> {
    let _apartment = ComApartment::initialize()?;
    let shortcut_wide = wide(shortcut.as_os_str());
    let mut target = [0u16; 32_768];

    unsafe {
        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        let persist_file: IPersistFile = shell_link.cast()?;
        persist_file.Load(PCWSTR(shortcut_wide.as_ptr()), Default::default())?;
        shell_link.GetPath(&mut target, std::ptr::null_mut(), 0)?;
    }

    let length = target
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(target.len());
    Ok(PathBuf::from(OsString::from_wide(&target[..length])))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn creates_and_replaces_a_shortcut_without_touching_the_real_desktop() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("quodex-shortcut-{unique}"));
        fs::create_dir_all(&root).expect("fixture directory");
        let executable = std::env::current_exe().expect("test executable");
        let shortcut = root.join(SHORTCUT_FILE_NAME);
        fs::write(&shortcut, b"stale shortcut").expect("stale shortcut fixture");

        replace_shortcut(&executable, &shortcut).expect("replace shortcut");

        assert_eq!(
            read_shortcut_target(&shortcut).expect("shortcut target"),
            executable
        );
        assert!(!root.join(PENDING_SHORTCUT_FILE_NAME).exists());
        fs::remove_dir_all(root).expect("remove fixture");
    }
}

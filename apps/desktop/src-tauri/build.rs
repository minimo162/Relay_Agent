use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const WINDOWS_TEST_MANIFEST_SOURCE: &str = "windows-test-app-manifest.xml";
const WINDOWS_TEST_MANIFEST_OUTPUT: &str = "windows-test-app-manifest.xml";

fn main() {
    tauri_build::build();
    configure_windows_test_manifest();
}

fn configure_windows_test_manifest() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os != "windows" || target_env != "msvc" {
        return;
    }

    let manifest_source = Path::new(WINDOWS_TEST_MANIFEST_SOURCE);
    println!("cargo:rerun-if-changed={}", manifest_source.display());

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR must be set"));
    let manifest_output = out_dir.join(WINDOWS_TEST_MANIFEST_OUTPUT);
    fs::copy(manifest_source, &manifest_output).expect("copy Windows test manifest");

    println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
    println!(
        "cargo:rustc-link-arg-tests={}",
        manifest_input_arg(&manifest_output)
    );
    println!("cargo:rustc-link-arg-tests=/WX");
}

fn manifest_input_arg(path: &Path) -> String {
    let path = path.display().to_string();
    if path.contains(' ') {
        format!("/MANIFESTINPUT:\"{path}\"")
    } else {
        format!("/MANIFESTINPUT:{path}")
    }
}

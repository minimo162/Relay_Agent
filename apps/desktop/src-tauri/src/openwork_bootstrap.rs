use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use thiserror::Error;
use zip::ZipArchive;

const MANIFEST_JSON: &str = include_str!("../bootstrap/openwork-opencode.json");
const DEFAULT_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapManifest {
    pub schema_version: u32,
    pub selected_track: String,
    pub ownership_boundary: String,
    pub platforms: BootstrapPlatforms,
    #[serde(default)]
    pub compatibility_notes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub struct BootstrapPlatforms {
    pub windows_x64: BootstrapPlatform,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPlatform {
    pub openwork_desktop: BootstrapArtifact,
    pub opencode_cli: BootstrapArtifact,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapArtifact {
    pub name: String,
    pub version: String,
    pub kind: String,
    pub format: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
    pub entrypoint: String,
    pub license: String,
    #[serde(default)]
    pub install_mode: Option<String>,
    #[serde(default)]
    pub usage: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BootstrapArtifactKey {
    OpenWorkDesktop,
    OpenCodeCli,
}

impl BootstrapArtifactKey {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OpenWorkDesktop => "openwork-desktop",
            Self::OpenCodeCli => "opencode-cli",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedBootstrapArtifact {
    pub platform: String,
    pub artifact: String,
    pub version: String,
    pub path: PathBuf,
    pub size: u64,
    pub sha256: String,
    pub reused: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedBootstrapArtifact {
    pub platform: String,
    pub artifact: String,
    pub version: String,
    pub extract_dir: PathBuf,
    pub entrypoint_path: PathBuf,
    pub reused: bool,
}

#[derive(Debug, Error)]
pub enum BootstrapError {
    #[error("bootstrap manifest is invalid: {0}")]
    Manifest(#[from] serde_json::Error),
    #[error("unsupported bootstrap platform: {0}")]
    UnsupportedPlatform(String),
    #[error("bootstrap artifact URL has an unsafe filename: {0}")]
    UnsafeFileName(String),
    #[error("bootstrap artifact filesystem error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("bootstrap artifact download failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("bootstrap artifact download returned HTTP {status} for {url}")]
    HttpStatus { url: String, status: u16 },
    #[error("bootstrap artifact size mismatch for {path}: expected {expected}, actual {actual}")]
    SizeMismatch {
        path: PathBuf,
        expected: u64,
        actual: u64,
    },
    #[error("bootstrap artifact sha256 mismatch for {path}: expected {expected}, actual {actual}")]
    Sha256Mismatch {
        path: PathBuf,
        expected: String,
        actual: String,
    },
    #[error("bootstrap artifact format is not supported for extraction: {0}")]
    UnsupportedArchiveFormat(String),
    #[error("bootstrap archive entry has an unsafe path: {0}")]
    UnsafeArchivePath(String),
    #[error("bootstrap archive error at {path}: {source}")]
    Archive {
        path: PathBuf,
        #[source]
        source: zip::result::ZipError,
    },
    #[error("OpenCode CLI probe failed for {path}: {message}")]
    Command { path: PathBuf, message: String },
}

impl BootstrapError {
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::Manifest(_) => "manifest",
            Self::UnsupportedPlatform(_) => "unsupported_platform",
            Self::UnsafeFileName(_) => "unsafe_file_name",
            Self::Io { .. } => "filesystem",
            Self::Http(_) => "network",
            Self::HttpStatus { .. } => "http_status",
            Self::SizeMismatch { .. } => "size_mismatch",
            Self::Sha256Mismatch { .. } => "sha256_mismatch",
            Self::UnsupportedArchiveFormat(_) => "unsupported_archive_format",
            Self::UnsafeArchivePath(_) => "unsafe_archive_path",
            Self::Archive { .. } => "archive",
            Self::Command { .. } => "command",
        }
    }
}

#[must_use]
pub fn manifest_json() -> &'static str {
    MANIFEST_JSON
}

pub fn load_manifest() -> Result<BootstrapManifest, BootstrapError> {
    Ok(serde_json::from_str(MANIFEST_JSON)?)
}

#[must_use]
pub fn bootstrap_cache_root(app_local_data_dir: &Path) -> PathBuf {
    app_local_data_dir.join("openwork-opencode-bootstrap")
}

pub fn platform_artifact<'a>(
    manifest: &'a BootstrapManifest,
    platform: &str,
    key: BootstrapArtifactKey,
) -> Result<&'a BootstrapArtifact, BootstrapError> {
    let platform = match platform {
        "windows-x64" => &manifest.platforms.windows_x64,
        other => return Err(BootstrapError::UnsupportedPlatform(other.to_string())),
    };

    Ok(match key {
        BootstrapArtifactKey::OpenWorkDesktop => &platform.openwork_desktop,
        BootstrapArtifactKey::OpenCodeCli => &platform.opencode_cli,
    })
}

pub fn artifact_cache_path(
    cache_root: &Path,
    platform: &str,
    key: BootstrapArtifactKey,
    artifact: &BootstrapArtifact,
) -> Result<PathBuf, BootstrapError> {
    Ok(cache_root
        .join(platform)
        .join(key.as_str())
        .join(&artifact.version)
        .join(artifact_filename(artifact)?))
}

pub fn artifact_extract_dir(
    cache_root: &Path,
    platform: &str,
    key: BootstrapArtifactKey,
    artifact: &BootstrapArtifact,
) -> PathBuf {
    cache_root
        .join(platform)
        .join(key.as_str())
        .join(&artifact.version)
        .join("extracted")
}

pub fn artifact_entrypoint_path(
    cache_root: &Path,
    platform: &str,
    key: BootstrapArtifactKey,
    artifact: &BootstrapArtifact,
) -> Result<PathBuf, BootstrapError> {
    if artifact.entrypoint.is_empty()
        || artifact.entrypoint == "."
        || artifact.entrypoint == ".."
        || artifact.entrypoint.contains('/')
        || artifact.entrypoint.contains('\\')
    {
        return Err(BootstrapError::UnsafeFileName(artifact.entrypoint.clone()));
    }
    Ok(artifact_extract_dir(cache_root, platform, key, artifact).join(&artifact.entrypoint))
}

pub fn verify_artifact_file(
    path: &Path,
    platform: &str,
    key: BootstrapArtifactKey,
    artifact: &BootstrapArtifact,
    reused: bool,
) -> Result<VerifiedBootstrapArtifact, BootstrapError> {
    let metadata = fs::metadata(path).map_err(|source| BootstrapError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    if metadata.len() != artifact.size {
        return Err(BootstrapError::SizeMismatch {
            path: path.to_path_buf(),
            expected: artifact.size,
            actual: metadata.len(),
        });
    }

    let actual = sha256_file(path)?;
    if actual != artifact.sha256 {
        return Err(BootstrapError::Sha256Mismatch {
            path: path.to_path_buf(),
            expected: artifact.sha256.clone(),
            actual,
        });
    }

    Ok(VerifiedBootstrapArtifact {
        platform: platform.to_string(),
        artifact: key.as_str().to_string(),
        version: artifact.version.clone(),
        path: path.to_path_buf(),
        size: artifact.size,
        sha256: artifact.sha256.clone(),
        reused,
    })
}

pub fn verify_cached_artifact(
    cache_root: &Path,
    platform: &str,
    key: BootstrapArtifactKey,
    artifact: &BootstrapArtifact,
) -> Result<Option<VerifiedBootstrapArtifact>, BootstrapError> {
    let path = artifact_cache_path(cache_root, platform, key, artifact)?;
    if !path.exists() {
        return Ok(None);
    }
    verify_artifact_file(&path, platform, key, artifact, true).map(Some)
}

pub fn download_and_verify_artifact(
    cache_root: &Path,
    platform: &str,
    key: BootstrapArtifactKey,
    artifact: &BootstrapArtifact,
) -> Result<VerifiedBootstrapArtifact, BootstrapError> {
    if let Some(cached) = verify_cached_artifact(cache_root, platform, key, artifact)? {
        return Ok(cached);
    }

    let destination = artifact_cache_path(cache_root, platform, key, artifact)?;
    let parent = destination
        .parent()
        .ok_or_else(|| BootstrapError::UnsafeFileName(artifact.url.clone()))?;
    fs::create_dir_all(parent).map_err(|source| BootstrapError::Io {
        path: parent.to_path_buf(),
        source,
    })?;

    if destination.exists() {
        fs::remove_file(&destination).map_err(|source| BootstrapError::Io {
            path: destination.clone(),
            source,
        })?;
    }

    let mut temp = NamedTempFile::new_in(parent).map_err(|source| BootstrapError::Io {
        path: parent.to_path_buf(),
        source,
    })?;
    download_to_writer(artifact, &mut temp)?;
    temp.flush().map_err(|source| BootstrapError::Io {
        path: temp.path().to_path_buf(),
        source,
    })?;

    verify_artifact_file(temp.path(), platform, key, artifact, false)?;
    temp.persist(&destination)
        .map_err(|error| BootstrapError::Io {
            path: destination.clone(),
            source: error.error,
        })?;

    verify_artifact_file(&destination, platform, key, artifact, false)
}

pub fn extract_zip_artifact(
    cache_root: &Path,
    platform: &str,
    key: BootstrapArtifactKey,
    artifact: &BootstrapArtifact,
) -> Result<ExtractedBootstrapArtifact, BootstrapError> {
    if artifact.format != "zip" {
        return Err(BootstrapError::UnsupportedArchiveFormat(
            artifact.format.clone(),
        ));
    }

    let archive_path = artifact_cache_path(cache_root, platform, key, artifact)?;
    verify_artifact_file(&archive_path, platform, key, artifact, true)?;
    let extract_dir = artifact_extract_dir(cache_root, platform, key, artifact);
    let entrypoint_path = artifact_entrypoint_path(cache_root, platform, key, artifact)?;
    if entrypoint_path.exists() {
        return Ok(ExtractedBootstrapArtifact {
            platform: platform.to_string(),
            artifact: key.as_str().to_string(),
            version: artifact.version.clone(),
            extract_dir,
            entrypoint_path,
            reused: true,
        });
    }

    if extract_dir.exists() {
        fs::remove_dir_all(&extract_dir).map_err(|source| BootstrapError::Io {
            path: extract_dir.clone(),
            source,
        })?;
    }
    fs::create_dir_all(&extract_dir).map_err(|source| BootstrapError::Io {
        path: extract_dir.clone(),
        source,
    })?;

    let archive_file = File::open(&archive_path).map_err(|source| BootstrapError::Io {
        path: archive_path.clone(),
        source,
    })?;
    let mut archive = ZipArchive::new(archive_file).map_err(|source| BootstrapError::Archive {
        path: archive_path.clone(),
        source,
    })?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|source| BootstrapError::Archive {
                path: archive_path.clone(),
                source,
            })?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| BootstrapError::UnsafeArchivePath(entry.name().to_string()))?
            .to_path_buf();
        if is_zip_symlink(entry.unix_mode()) {
            return Err(BootstrapError::UnsafeArchivePath(entry.name().to_string()));
        }

        let destination = extract_dir.join(enclosed);
        if entry.is_dir() {
            fs::create_dir_all(&destination).map_err(|source| BootstrapError::Io {
                path: destination.clone(),
                source,
            })?;
            continue;
        }

        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|source| BootstrapError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        let mut output = File::create(&destination).map_err(|source| BootstrapError::Io {
            path: destination.clone(),
            source,
        })?;
        io::copy(&mut entry, &mut output).map_err(|source| BootstrapError::Io {
            path: destination.clone(),
            source,
        })?;

        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&destination, fs::Permissions::from_mode(mode & 0o777)).map_err(
                |source| BootstrapError::Io {
                    path: destination.clone(),
                    source,
                },
            )?;
        }
    }

    if !entrypoint_path.exists() {
        return Err(BootstrapError::Io {
            path: entrypoint_path,
            source: io::Error::new(io::ErrorKind::NotFound, "OpenCode entrypoint not found"),
        });
    }

    Ok(ExtractedBootstrapArtifact {
        platform: platform.to_string(),
        artifact: key.as_str().to_string(),
        version: artifact.version.clone(),
        extract_dir,
        entrypoint_path,
        reused: false,
    })
}

pub fn probe_opencode_entrypoint(path: &Path) -> Result<String, BootstrapError> {
    let output = Command::new(path)
        .arg("--version")
        .output()
        .map_err(|error| BootstrapError::Command {
            path: path.to_path_buf(),
            message: error.to_string(),
        })?;
    if !output.status.success() {
        return Err(BootstrapError::Command {
            path: path.to_path_buf(),
            message: format!(
                "exit {}: {}{}",
                output.status,
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            ),
        });
    }
    Ok(format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
    .trim()
    .to_string())
}

fn download_to_writer(
    artifact: &BootstrapArtifact,
    writer: &mut impl Write,
) -> Result<(), BootstrapError> {
    let client = reqwest::blocking::Client::builder()
        .timeout(DEFAULT_DOWNLOAD_TIMEOUT)
        .build()?;
    let mut response = client.get(&artifact.url).send()?;
    let status = response.status();
    if !status.is_success() {
        return Err(BootstrapError::HttpStatus {
            url: artifact.url.clone(),
            status: status.as_u16(),
        });
    }
    io::copy(&mut response, writer).map_err(|source| BootstrapError::Io {
        path: PathBuf::from("<download-stream>"),
        source,
    })?;
    Ok(())
}

fn is_zip_symlink(mode: Option<u32>) -> bool {
    const FILE_TYPE_MASK: u32 = 0o170000;
    const SYMLINK: u32 = 0o120000;
    mode.is_some_and(|mode| mode & FILE_TYPE_MASK == SYMLINK)
}

fn artifact_filename(artifact: &BootstrapArtifact) -> Result<String, BootstrapError> {
    let raw = artifact
        .url
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| BootstrapError::UnsafeFileName(artifact.url.clone()))?;
    if raw == "." || raw == ".." || raw.contains('\\') || raw.contains('/') {
        return Err(BootstrapError::UnsafeFileName(raw.to_string()));
    }
    Ok(raw.to_string())
}

fn sha256_file(path: &Path) -> Result<String, BootstrapError> {
    let mut file = File::open(path).map_err(|source| BootstrapError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|source| BootstrapError::Io {
                path: path.to_path_buf(),
                source,
            })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    fn fixture_artifact(url: String, body: &[u8]) -> BootstrapArtifact {
        BootstrapArtifact {
            name: "Fixture".to_string(),
            version: "1.0.0".to_string(),
            kind: "archive".to_string(),
            format: "zip".to_string(),
            url,
            sha256: sha256_bytes(body),
            size: body.len() as u64,
            entrypoint: "fixture.exe".to_string(),
            license: "MIT".to_string(),
            install_mode: None,
            usage: None,
        }
    }

    fn sha256_bytes(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8], u32)]) {
        let file = File::create(path).expect("create zip");
        let mut writer = ZipWriter::new(file);
        for (name, body, mode) in entries {
            let options = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Deflated)
                .unix_permissions(*mode);
            writer.start_file(name, options).expect("start file");
            writer.write_all(body).expect("write file");
        }
        writer.finish().expect("finish zip");
    }

    fn serve_once(body: &'static [u8], status: u16) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("local addr");
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            let status_text = if status == 200 { "OK" } else { "Test Error" };
            let response = format!(
                "HTTP/1.1 {status} {status_text}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .expect("write headers");
            stream.write_all(body).expect("write body");
        });
        format!("http://{address}/fixture.zip")
    }

    #[test]
    fn manifest_pins_windows_artifacts() {
        let manifest = load_manifest().expect("manifest parses");
        let openwork = platform_artifact(
            &manifest,
            "windows-x64",
            BootstrapArtifactKey::OpenWorkDesktop,
        )
        .expect("openwork artifact");
        assert_eq!(openwork.version, "0.11.212");
        assert_eq!(openwork.format, "msi");
        assert_eq!(
            openwork.sha256,
            "e52d020a1f6c2073164ed06279c441869844cb07a396bffac0789d63a4b7f486"
        );

        let opencode =
            platform_artifact(&manifest, "windows-x64", BootstrapArtifactKey::OpenCodeCli)
                .expect("opencode artifact");
        assert_eq!(opencode.version, "1.14.25");
        assert_eq!(opencode.format, "zip");
        assert_eq!(
            opencode.sha256,
            "8eada3506f0e22071de5d28d5f82df198d4c39f941c2bbf74d6c5de639f8e05b"
        );
    }

    #[test]
    fn cache_root_lives_under_app_local_data_dir() {
        let root = bootstrap_cache_root(Path::new("/tmp/relay-app-data"));
        assert_eq!(
            root,
            Path::new("/tmp/relay-app-data").join("openwork-opencode-bootstrap")
        );
    }

    #[test]
    fn entrypoint_path_uses_extracted_artifact_directory() {
        let artifact = fixture_artifact(
            "https://example.invalid/opencode-windows-x64.zip".to_string(),
            b"fixture",
        );
        let path = artifact_entrypoint_path(
            Path::new("/tmp/relay-cache"),
            "windows-x64",
            BootstrapArtifactKey::OpenCodeCli,
            &artifact,
        )
        .expect("entrypoint path");
        assert_eq!(
            path,
            Path::new("/tmp/relay-cache")
                .join("windows-x64")
                .join("opencode-cli")
                .join("1.0.0")
                .join("extracted")
                .join("fixture.exe")
        );
    }

    #[test]
    fn entrypoint_path_rejects_nested_or_absolute_entrypoint() {
        let mut artifact = fixture_artifact(
            "https://example.invalid/opencode-windows-x64.zip".to_string(),
            b"fixture",
        );
        artifact.entrypoint = "../opencode.exe".to_string();
        let error = artifact_entrypoint_path(
            Path::new("/tmp/relay-cache"),
            "windows-x64",
            BootstrapArtifactKey::OpenCodeCli,
            &artifact,
        )
        .expect_err("unsafe entrypoint");
        assert_eq!(error.code(), "unsafe_file_name");
    }

    #[test]
    fn verify_cached_artifact_reuses_existing_valid_file() {
        let temp = tempfile::tempdir().expect("tempdir");
        let body = b"relay bootstrap fixture";
        let artifact = fixture_artifact(
            "https://example.invalid/opencode-windows-x64.zip".to_string(),
            body,
        );
        let path = artifact_cache_path(
            temp.path(),
            "windows-x64",
            BootstrapArtifactKey::OpenCodeCli,
            &artifact,
        )
        .expect("artifact path");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        fs::write(&path, body).expect("write fixture");

        let verified = verify_cached_artifact(
            temp.path(),
            "windows-x64",
            BootstrapArtifactKey::OpenCodeCli,
            &artifact,
        )
        .expect("verify")
        .expect("cached");
        assert!(verified.reused);
        assert_eq!(verified.path, path);
    }

    #[test]
    fn verify_artifact_reports_checksum_mismatch() {
        let temp = tempfile::tempdir().expect("tempdir");
        let path = temp.path().join("artifact.zip");
        fs::write(&path, b"actual").expect("write artifact");
        let mut artifact = fixture_artifact(
            "https://example.invalid/artifact.zip".to_string(),
            b"actual",
        );
        artifact.sha256 = sha256_bytes(b"expected");

        let error = verify_artifact_file(
            &path,
            "windows-x64",
            BootstrapArtifactKey::OpenCodeCli,
            &artifact,
            false,
        )
        .expect_err("checksum mismatch");
        assert_eq!(error.code(), "sha256_mismatch");
    }

    #[test]
    fn download_and_verify_writes_valid_artifact_to_cache() {
        let temp = tempfile::tempdir().expect("tempdir");
        let body = b"downloaded bootstrap artifact";
        let artifact = fixture_artifact(serve_once(body, 200), body);

        let verified = download_and_verify_artifact(
            temp.path(),
            "windows-x64",
            BootstrapArtifactKey::OpenCodeCli,
            &artifact,
        )
        .expect("download");

        assert!(!verified.reused);
        assert!(verified.path.exists());
        assert_eq!(fs::read(&verified.path).expect("read artifact"), body);
    }

    #[test]
    fn download_size_mismatch_cleans_partial_file() {
        let temp = tempfile::tempdir().expect("tempdir");
        let body = b"short";
        let mut artifact = fixture_artifact(serve_once(body, 200), body);
        artifact.size = 999;

        let error = download_and_verify_artifact(
            temp.path(),
            "windows-x64",
            BootstrapArtifactKey::OpenCodeCli,
            &artifact,
        )
        .expect_err("size mismatch");
        assert_eq!(error.code(), "size_mismatch");

        let destination = artifact_cache_path(
            temp.path(),
            "windows-x64",
            BootstrapArtifactKey::OpenCodeCli,
            &artifact,
        )
        .expect("destination");
        assert!(!destination.exists());
    }

    #[test]
    fn extract_zip_artifact_writes_safe_entrypoint_and_probe_runs_version() {
        let temp = tempfile::tempdir().expect("tempdir");
        let archive_path = temp.path().join("opencode-windows-x64.zip");
        write_zip(
            &archive_path,
            &[(
                "opencode.exe",
                b"#!/bin/sh\necho opencode fixture-1.0\n",
                0o755,
            )],
        );
        let body = fs::read(&archive_path).expect("read zip");
        let artifact = BootstrapArtifact {
            name: "OpenCode CLI Fixture".to_string(),
            version: "1.0.0".to_string(),
            kind: "archive".to_string(),
            format: "zip".to_string(),
            url: "https://example.invalid/opencode-windows-x64.zip".to_string(),
            sha256: sha256_bytes(&body),
            size: body.len() as u64,
            entrypoint: "opencode.exe".to_string(),
            license: "MIT".to_string(),
            install_mode: None,
            usage: Some("provider-config".to_string()),
        };
        let cached = artifact_cache_path(
            temp.path(),
            "windows-x64",
            BootstrapArtifactKey::OpenCodeCli,
            &artifact,
        )
        .expect("cache path");
        fs::create_dir_all(cached.parent().expect("parent")).expect("create cache parent");
        fs::copy(&archive_path, &cached).expect("copy archive");

        let extracted = extract_zip_artifact(
            temp.path(),
            "windows-x64",
            BootstrapArtifactKey::OpenCodeCli,
            &artifact,
        )
        .expect("extract");
        assert!(!extracted.reused);
        assert!(extracted.entrypoint_path.exists());

        let version = probe_opencode_entrypoint(&extracted.entrypoint_path).expect("probe");
        assert_eq!(version, "opencode fixture-1.0");
    }

    #[test]
    fn extract_zip_artifact_rejects_path_traversal() {
        let temp = tempfile::tempdir().expect("tempdir");
        let archive_path = temp.path().join("opencode-windows-x64.zip");
        write_zip(&archive_path, &[("../opencode.exe", b"bad", 0o755)]);
        let body = fs::read(&archive_path).expect("read zip");
        let artifact = BootstrapArtifact {
            name: "OpenCode CLI Fixture".to_string(),
            version: "1.0.0".to_string(),
            kind: "archive".to_string(),
            format: "zip".to_string(),
            url: "https://example.invalid/opencode-windows-x64.zip".to_string(),
            sha256: sha256_bytes(&body),
            size: body.len() as u64,
            entrypoint: "opencode.exe".to_string(),
            license: "MIT".to_string(),
            install_mode: None,
            usage: None,
        };
        let cached = artifact_cache_path(
            temp.path(),
            "windows-x64",
            BootstrapArtifactKey::OpenCodeCli,
            &artifact,
        )
        .expect("cache path");
        fs::create_dir_all(cached.parent().expect("parent")).expect("create cache parent");
        fs::copy(&archive_path, &cached).expect("copy archive");

        let error = extract_zip_artifact(
            temp.path(),
            "windows-x64",
            BootstrapArtifactKey::OpenCodeCli,
            &artifact,
        )
        .expect_err("unsafe archive path");
        assert_eq!(error.code(), "unsafe_archive_path");
    }
}

//! Windows: bind the current process to a Job Object with
//! `KILL_ON_JOB_CLOSE` so sidecar children (`relay-node.exe`, `relay-rg.exe`,
//! `WebView2` helpers, etc.) die with us.
//!
//! Why: if the Tauri dev app is force-killed, orphaned children keep
//! `target\debug\relay-node.exe` locked, and the next `tauri dev` panics in
//! `tauri-build`'s `copy_binaries` at `fs::remove_file(&dest).unwrap()`
//! with Windows error 5 (access denied).

#[cfg(windows)]
pub(crate) fn install_kill_on_close() {
    use win32job::{ExtendedLimitInfo, Job};

    let Ok(job) = Job::create() else {
        return;
    };
    let mut info = ExtendedLimitInfo::new();
    info.limit_kill_on_job_close();
    if job.set_extended_limit_info(&info).is_err() {
        return;
    }
    // Nested jobs are allowed on Win8+; if assignment fails (e.g. the host
    // debugger or cargo put us in a non-nestable job) silently fall through.
    let _ = job.assign_current_process();

    // Leak the handle: keep it alive for the process lifetime. Dropping it
    // would trigger `KILL_ON_JOB_CLOSE` and terminate us.
    std::mem::forget(job);
}

#[cfg(not(windows))]
pub(crate) fn install_kill_on_close() {}

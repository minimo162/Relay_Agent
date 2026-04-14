use std::path::PathBuf;

use relay_agent_desktop_lib::doctor::{
    default_browser_settings, run_doctor_blocking, RelayDoctorOptions,
};

fn main() {
    let mut options = RelayDoctorOptions {
        browser_settings: default_browser_settings(),
        ..RelayDoctorOptions::default()
    };
    let mut json_output = false;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--json" => json_output = true,
            "--workspace" => {
                let value = args.next().unwrap_or_else(|| {
                    eprintln!("--workspace requires a path");
                    std::process::exit(2);
                });
                options.workspace = Some(PathBuf::from(value));
            }
            "--cdp-port" => {
                let value = args.next().unwrap_or_else(|| {
                    eprintln!("--cdp-port requires a port");
                    std::process::exit(2);
                });
                let port = value.parse::<u16>().unwrap_or_else(|_| {
                    eprintln!("invalid --cdp-port: {value}");
                    std::process::exit(2);
                });
                options.browser_settings.cdp_port = port;
            }
            "--timeout-ms" => {
                let value = args.next().unwrap_or_else(|| {
                    eprintln!("--timeout-ms requires a value");
                    std::process::exit(2);
                });
                let timeout = value.parse::<u32>().unwrap_or_else(|_| {
                    eprintln!("invalid --timeout-ms: {value}");
                    std::process::exit(2);
                });
                options.browser_settings.timeout_ms = timeout;
            }
            "--no-auto-launch-edge" => {
                options.auto_launch_edge = false;
                options.browser_settings.auto_launch_edge = false;
            }
            "--help" | "-h" => {
                print_help();
                return;
            }
            _ => {
                eprintln!("unknown argument: {arg}");
                print_help();
                std::process::exit(2);
            }
        }
    }

    let report = run_doctor_blocking(options);
    if json_output {
        println!(
            "{}",
            serde_json::to_string_pretty(&report).expect("serialize doctor report")
        );
    } else {
        println!("status: {:?}", report.status);
        for check in &report.checks {
            println!("[{:?}] {}: {}", check.status, check.id, check.message);
        }
    }

    let exit_code = match report.status {
        relay_agent_desktop_lib::models::RelayDoctorStatus::Ok => 0,
        relay_agent_desktop_lib::models::RelayDoctorStatus::Warn => 1,
        relay_agent_desktop_lib::models::RelayDoctorStatus::Fail => 2,
    };
    std::process::exit(exit_code);
}

fn print_help() {
    eprintln!(
        "relay-agent-doctor [--json] [--workspace <path>] [--cdp-port <port>] [--timeout-ms <ms>] [--no-auto-launch-edge]"
    );
}

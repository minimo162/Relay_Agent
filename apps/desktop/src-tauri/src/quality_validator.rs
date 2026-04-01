use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use crate::models::{QualityCheck, QualityCheckResult};

pub fn validate_output_quality(
    source_path: &str,
    output_path: &str,
) -> Result<QualityCheckResult, String> {
    let mut checks = Vec::new();
    let mut warnings = Vec::new();

    let source_rows = count_rows(source_path)?;
    let output_rows = count_rows(output_path)?;
    let row_check = if output_rows == 0 && source_rows > 0 {
        warnings.push("出力ファイルが空です。データ欠損の可能性があります。".to_string());
        QualityCheck {
            name: "行数チェック".to_string(),
            passed: false,
            detail: format!("入力: {}行 -> 出力: {}行（全行消失）", source_rows, output_rows),
        }
    } else {
        QualityCheck {
            name: "行数チェック".to_string(),
            passed: true,
            detail: format!("入力: {}行 -> 出力: {}行", source_rows, output_rows),
        }
    };
    checks.push(row_check);

    let source_empty_ratio = count_empty_ratio(source_path)?;
    let output_empty_ratio = count_empty_ratio(output_path)?;
    if output_empty_ratio > source_empty_ratio + 0.2 {
        warnings.push(format!(
            "空値の割合が大幅に増加しています（{:.1}% -> {:.1}%）",
            source_empty_ratio * 100.0,
            output_empty_ratio * 100.0
        ));
        checks.push(QualityCheck {
            name: "空値チェック".to_string(),
            passed: false,
            detail: format!(
                "空値率: {:.1}% -> {:.1}%",
                source_empty_ratio * 100.0,
                output_empty_ratio * 100.0
            ),
        });
    } else {
        checks.push(QualityCheck {
            name: "空値チェック".to_string(),
            passed: true,
            detail: format!(
                "空値率: {:.1}% -> {:.1}%",
                source_empty_ratio * 100.0,
                output_empty_ratio * 100.0
            ),
        });
    }

    let encoding_ok = verify_encoding(output_path)?;
    checks.push(QualityCheck {
        name: "エンコーディング".to_string(),
        passed: encoding_ok,
        detail: if encoding_ok {
            "UTF-8 確認済み".to_string()
        } else {
            "非 UTF-8 文字を検出".to_string()
        },
    });

    let injection_safe = check_csv_injection(output_path)?;
    if !injection_safe {
        warnings.push("CSV インジェクションの可能性がある値を検出しました。".to_string());
    }
    checks.push(QualityCheck {
        name: "CSV インジェクション".to_string(),
        passed: injection_safe,
        detail: if injection_safe {
            "安全".to_string()
        } else {
            "危険な先頭文字 (=, +, -, @) を検出".to_string()
        },
    });

    let passed = checks.iter().all(|check| check.passed);
    Ok(QualityCheckResult {
        passed,
        checks,
        warnings,
    })
}

fn count_rows(path: &str) -> Result<usize, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::InvalidData => {
            return Ok(binary_row_count_hint(path));
        }
        Err(error) => return Err(format!("failed to read `{path}`: {error}")),
    };
    Ok(content.lines().count())
}

fn count_empty_ratio(path: &str) -> Result<f64, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::InvalidData => return Ok(0.0),
        Err(error) => return Err(format!("failed to read `{path}`: {error}")),
    };
    let mut total_cells = 0_usize;
    let mut empty_cells = 0_usize;
    for line in content.lines() {
        for cell in line.split(',') {
            total_cells += 1;
            if cell.trim().is_empty() {
                empty_cells += 1;
            }
        }
    }
    if total_cells == 0 {
        return Ok(0.0);
    }
    Ok(empty_cells as f64 / total_cells as f64)
}

fn verify_encoding(path: &str) -> Result<bool, String> {
    match fs::read_to_string(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == ErrorKind::InvalidData => Ok(false),
        Err(error) => Err(format!("failed to read `{path}`: {error}")),
    }
}

fn check_csv_injection(path: &str) -> Result<bool, String> {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension != "csv" {
        return Ok(true);
    }

    let content = fs::read_to_string(path).map_err(|error| format!("failed to read `{path}`: {error}"))?;
    let dangerous_prefixes = ['=', '+', '-', '@'];
    for line in content.lines().skip(1) {
        for cell in line.split(',') {
            let trimmed = cell.trim().trim_matches('"');
            if let Some(first_char) = trimmed.chars().next() {
                if dangerous_prefixes.contains(&first_char) {
                    return Ok(false);
                }
            }
        }
    }
    Ok(true)
}

fn binary_row_count_hint(path: &str) -> usize {
    Path::new(path)
        .metadata()
        .ok()
        .map(|metadata| if metadata.len() > 0 { 1 } else { 0 })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::fs;

    use super::validate_output_quality;

    #[test]
    fn flags_empty_output_files() {
        let source_path = env::temp_dir().join("relay-quality-source.csv");
        let output_path = env::temp_dir().join("relay-quality-output.csv");
        fs::write(&source_path, "name,value\nalpha,1\n").expect("source csv should write");
        fs::write(&output_path, "").expect("output csv should write");

        let result = validate_output_quality(
            source_path.to_str().expect("source path should render"),
            output_path.to_str().expect("output path should render"),
        )
        .expect("quality validation should succeed");

        assert!(!result.passed);
        assert!(result.warnings.iter().any(|warning| warning.contains("空です")));

        fs::remove_file(source_path).expect("source file should clean up");
        fs::remove_file(output_path).expect("output file should clean up");
    }
}

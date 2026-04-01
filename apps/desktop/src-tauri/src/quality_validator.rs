use std::fs;
use std::io::{BufReader, ErrorKind, Read};
use std::path::Path;

use crate::models::{QualityCheck, QualityCheckResult};

const MAX_QUALITY_CHECK_BYTES: u64 = 10 * 1024 * 1024;

pub fn validate_output_quality(
    source_path: &str,
    output_path: &str,
) -> Result<QualityCheckResult, String> {
    let mut checks = Vec::new();
    let mut warnings = Vec::new();

    let source_rows = count_rows(source_path, &mut warnings)?;
    let output_rows = count_rows(output_path, &mut warnings)?;
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

    let source_empty_ratio = count_empty_ratio(source_path, &mut warnings)?;
    let output_empty_ratio = count_empty_ratio(output_path, &mut warnings)?;
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

    let injection_safe = check_csv_injection(output_path, &mut warnings)?;
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

fn count_rows(path: &str, warnings: &mut Vec<String>) -> Result<usize, String> {
    let (content, truncated) = match read_sample(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::InvalidData => {
            push_unique_warning(warnings, sample_warning(path, false)?);
            return Ok(binary_row_count_hint(path));
        }
        Err(error) => return Err(format!("failed to read `{path}`: {error}")),
    };
    if truncated {
        push_unique_warning(warnings, sample_warning(path, true)?);
    }
    Ok(content.lines().count())
}

fn count_empty_ratio(path: &str, warnings: &mut Vec<String>) -> Result<f64, String> {
    let (content, truncated) = match read_sample(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::InvalidData => return Ok(0.0),
        Err(error) => return Err(format!("failed to read `{path}`: {error}")),
    };
    if truncated {
        push_unique_warning(warnings, sample_warning(path, true)?);
    }
    let mut total_cells = 0_usize;
    let mut empty_cells = 0_usize;
    for line in content.lines() {
        for cell in split_csv_line(line) {
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

fn check_csv_injection(path: &str, warnings: &mut Vec<String>) -> Result<bool, String> {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension != "csv" {
        return Ok(true);
    }

    let (content, truncated) =
        read_sample(path).map_err(|error| format!("failed to read `{path}`: {error}"))?;
    if truncated {
        push_unique_warning(warnings, sample_warning(path, true)?);
    }
    let dangerous_prefixes = ['=', '+', '-', '@'];
    for line in content.lines().skip(1) {
        for cell in split_csv_line(line) {
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

fn read_sample(path: &str) -> Result<(String, bool), std::io::Error> {
    let file = fs::File::open(path)?;
    let size = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    let truncated = size > MAX_QUALITY_CHECK_BYTES;
    let mut reader = BufReader::new(file.take(MAX_QUALITY_CHECK_BYTES));
    let mut content = String::new();
    reader.read_to_string(&mut content)?;
    Ok((content, truncated))
}

fn sample_warning(path: &str, sampled: bool) -> Result<String, String> {
    let size_bytes = Path::new(path)
        .metadata()
        .map(|metadata| metadata.len())
        .map_err(|error| format!("failed to read metadata for `{path}`: {error}"))?;
    let size_mb = size_bytes as f64 / (1024.0 * 1024.0);
    Ok(if sampled {
        format!(
            "ファイルが大きいため先頭 10MB のみを検査しました（実際のファイルサイズ: {:.1} MB）",
            size_mb
        )
    } else {
        format!(
            "UTF-8 以外のため先頭 10MB のみを基準に行数ヒントを計算しました（実際のファイルサイズ: {:.1} MB）",
            size_mb
        )
    })
}

fn push_unique_warning(warnings: &mut Vec<String>, warning: String) {
    if !warnings.iter().any(|existing| existing == &warning) {
        warnings.push(warning);
    }
}

fn split_csv_line(line: &str) -> Vec<&str> {
    let mut fields = Vec::new();
    let mut start = 0;
    let mut in_quotes = false;
    let bytes = line.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        match bytes[index] {
            b'"' => {
                if in_quotes && index + 1 < bytes.len() && bytes[index + 1] == b'"' {
                    index += 1;
                } else {
                    in_quotes = !in_quotes;
                }
            }
            b',' if !in_quotes => {
                fields.push(&line[start..index]);
                start = index + 1;
            }
            _ => {}
        }
        index += 1;
    }

    fields.push(&line[start..]);
    fields
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

    use super::{split_csv_line, validate_output_quality, MAX_QUALITY_CHECK_BYTES};

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

    #[test]
    fn split_csv_line_handles_quoted_commas() {
        let fields = split_csv_line(r#""hello,world","test","","val""#);

        assert_eq!(fields.len(), 4);
        assert_eq!(fields[0], r#""hello,world""#);
        assert_eq!(fields[2], r#""""#);
    }

    #[test]
    fn split_csv_line_handles_plain_cells() {
        let fields = split_csv_line("a,b,,d");

        assert_eq!(fields.len(), 4);
        assert_eq!(fields[2], "");
    }

    #[test]
    fn quoted_commas_do_not_break_quality_checks() {
        let source_path = env::temp_dir().join("relay-quality-quoted-source.csv");
        let output_path = env::temp_dir().join("relay-quality-quoted-output.csv");
        fs::write(&source_path, "name,notes\nalpha,\"hello,world\"\n").expect("source csv should write");
        fs::write(&output_path, "name,notes\nalpha,\"hello,world\"\n").expect("output csv should write");

        let result = validate_output_quality(
            source_path.to_str().expect("source path should render"),
            output_path.to_str().expect("output path should render"),
        )
        .expect("quality validation should succeed");

        assert!(result.passed);
        assert!(!result.warnings.iter().any(|warning| warning.contains("CSV インジェクション")));

        fs::remove_file(source_path).expect("source file should clean up");
        fs::remove_file(output_path).expect("output file should clean up");
    }

    #[test]
    fn warns_when_large_files_are_sampled() {
        let source_path = env::temp_dir().join("relay-quality-large-source.csv");
        let output_path = env::temp_dir().join("relay-quality-large-output.csv");
        let repeated_line = "name,value\nalpha,1\n";
        let large_content = repeated_line.repeat((MAX_QUALITY_CHECK_BYTES as usize / repeated_line.len()) + 1024);
        fs::write(&source_path, &large_content).expect("source csv should write");
        fs::write(&output_path, &large_content).expect("output csv should write");

        let result = validate_output_quality(
            source_path.to_str().expect("source path should render"),
            output_path.to_str().expect("output path should render"),
        )
        .expect("quality validation should succeed");

        assert!(result
            .warnings
            .iter()
            .any(|warning| warning.contains("先頭 10MB のみを検査しました")));

        fs::remove_file(source_path).expect("source file should clean up");
        fs::remove_file(output_path).expect("output file should clean up");
    }
}

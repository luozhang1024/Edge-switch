//! Reference estimates, never a substitute for the provider's bill.
use crate::{store, State};
use serde_json::{json, Value};
use std::{fs, path::Path};

pub fn defaults() -> Vec<Value> {
    serde_json::from_str(include_str!("../usage-pricing.json")).unwrap()
}
fn path(directory: &Path, profile: &str) -> std::path::PathBuf {
    directory
        .join("usage-pricing")
        .join(format!("{profile}.json"))
}
fn custom(directory: &Path, profile: &str) -> Result<Vec<Value>, String> {
    match fs::read(path(directory, profile)) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "用量单价配置损坏，未覆盖原文件".into())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e.to_string()),
    }
}
pub fn effective(directory: &Path, profile: &str) -> Result<Vec<Value>, String> {
    let mut rates = defaults();
    for rate in custom(directory, profile)? {
        rates.retain(|r| r["provider"] != rate["provider"] || r["model"] != rate["model"]);
        rates.push(rate);
    }
    Ok(rates)
}
fn validate(rate: &mut Value) -> Result<(), String> {
    for k in ["provider", "model"] {
        let s = rate[k].as_str().unwrap_or("").trim();
        if s.is_empty() || s.len() > 256 {
            return Err("供应商和模型不能为空或过长".into());
        }
        rate[k] = json!(s);
    }
    for k in ["input", "output", "cached", "write"] {
        if !rate[k]
            .as_f64()
            .is_some_and(|n| n.is_finite() && (0.0..=1_000_000.0).contains(&n))
        {
            return Err("单价必须是 0 到 1000000 之间的数字（美元 / 百万 Tokens）".into());
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn usage_pricing(
    state: tauri::State<'_, State>,
    profile_id: String,
    rate: Option<Value>,
    remove: Option<bool>,
) -> Result<Value, String> {
    let _guard = state.0.mutation.lock().await;
    let directory = {
        let s = state.0.store.lock().unwrap();
        s.profile(&profile_id)?;
        s.directory.clone()
    };
    if let Some(mut rate) = rate {
        validate(&mut rate)?;
        let mut rates = custom(&directory, &profile_id)?;
        rates.retain(|r| r["provider"] != rate["provider"] || r["model"] != rate["model"]);
        if !remove.unwrap_or(false) {
            rates.push(rate);
        }
        store::atomic_write(
            &path(&directory, &profile_id),
            &serde_json::to_vec_pretty(&rates).map_err(|e| e.to_string())?,
        )?;
    }
    Ok(
        json!({"rates":effective(&directory,&profile_id)?,"custom":custom(&directory,&profile_id)?,"source":"cc-switch-reference"}),
    )
}

fn normalized(model: &str) -> String {
    let model = model
        .rsplit('/')
        .next()
        .unwrap_or(model)
        .rsplit(':')
        .next()
        .unwrap_or(model)
        .to_lowercase();
    for suffix in ["-minimal", "-medium", "-xhigh", "-high", "-low"] {
        if let Some(base) = model.strip_suffix(suffix) {
            return base.into();
        }
    }
    model
}
pub fn price_rows(rows: &mut [Value], rates: &[Value]) {
    for row in rows {
        if row["cost"]
            .as_f64()
            .is_some_and(|n| n.is_finite() && n >= 0.0)
        {
            row["cost_source"] = json!("recorded");
            continue;
        }
        row["cost"] = Value::Null;
        row["cost_source"] = json!("unknown");
        let provider = row["provider"].as_str().unwrap_or("");
        let model = row["model"].as_str().unwrap_or("");
        let normalized = normalized(model);
        let rate = rates
            .iter()
            .find(|r| r["provider"] == provider && r["model"] == model)
            .or_else(|| {
                rates
                    .iter()
                    .find(|r| r["provider"] == "*" && r["model"] == model)
            })
            .or_else(|| {
                rates
                    .iter()
                    .find(|r| r["provider"] == "*" && r["model"] == normalized)
            });
        let Some(rate) = rate else {
            continue;
        };
        // Account subscriptions and credits are not token-priced API bills.
        if provider == "deepseek-account" && rate["provider"] == "*" {
            continue;
        }
        let cost = ["input", "output", "cached", "write"]
            .iter()
            .map(|k| row[k].as_f64().unwrap_or(0.0) * rate[k].as_f64().unwrap_or(0.0) / 1_000_000.0)
            .sum::<f64>();
        row["cost"] = json!(cost);
        row["cost_source"] = json!("estimated");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn estimates_preserve_recorded_cost_and_explicit_provider_rates() {
        let mut rows = vec![
            json!({"provider":"custom","model":"gpt-6.1-sol","input":1000000,"output":1000000,"cached":1000000,"write":0,"cost":null}),
            json!({"provider":"custom","model":"unknown","cost":2.5}),
            json!({"provider":"deepseek-account","model":"deepseek-flash","input":1000000}),
            json!({"provider":"custom","model":"new-model","input":100}),
        ];
        let mut rates = defaults();
        price_rows(&mut rows, &rates);
        assert!((rows[0]["cost"].as_f64().unwrap() - 12.1).abs() < 0.000001);
        assert_eq!(rows[0]["cost_source"], "estimated");
        assert_eq!(rows[1]["cost"], 2.5);
        assert!(rows[2]["cost"].is_null());
        assert!(rows[3]["cost"].is_null());
        rates.push(json!({"provider":"custom","model":"gpt-6.1-sol","input":1,"output":2,"cached":0,"write":0}));
        rows[0]["cost"] = Value::Null;
        price_rows(&mut rows, &rates);
        assert_eq!(rows[0]["cost"], 3.0);
    }
    #[test]
    fn pricing_validation_rejects_negative_and_missing_fields() {
        assert!(validate(
            &mut json!({"provider":"x","model":"y","input":-1,"output":0,"cached":0,"write":0})
        )
        .is_err());
        assert!(
            validate(&mut json!({"provider":"x","model":"y","input":0,"output":0,"cached":0}))
                .is_err()
        );
    }
    #[test]
    fn aggregate_prices_all_requests_before_pagination() {
        let rows:Vec<_>=(0..61).map(|id|json!({"id":id.to_string(),"tool":"codex","provider":"custom","model":"gpt-6.1-sol","timestamp":100.0,"input":1000000,"output":1000000,"cached":1000000,"write":0,"cost":null})).collect();
        let files = json!({"files":[{"usageRows":rows}],"warnings":[]});
        let mut params = json!({"start":0.0,"end":200.0,"page":0,"rates":defaults()});
        let first = crate::native_sessions::aggregate(&files, &params);
        assert!((first["totals"]["cost"].as_f64().unwrap() - 61.0 * 12.1).abs() < 0.00001);
        assert_eq!(first["totals"]["estimated"], 61);
        assert_eq!(first["rows"].as_array().unwrap().len(), 50);
        params["page"] = json!(1);
        let second = crate::native_sessions::aggregate(&files, &params);
        assert_eq!(second["totals"], first["totals"]);
        assert_eq!(second["rows"].as_array().unwrap().len(), 11);
    }
    #[test]
    fn custom_prices_are_scoped_to_saved_environment() {
        let dir = std::env::temp_dir().join(store::new_id());
        let rate = json!({"provider":"custom","model":"gpt-6.1-sol","input":1,"output":2,"cached":0,"write":0});
        store::atomic_write(
            &path(&dir, "environment-a"),
            &serde_json::to_vec(&vec![rate.clone()]).unwrap(),
        )
        .unwrap();
        assert!(effective(&dir, "environment-a").unwrap().contains(&rate));
        assert!(!effective(&dir, "environment-b").unwrap().contains(&rate));
        fs::remove_dir_all(dir).unwrap();
    }
}

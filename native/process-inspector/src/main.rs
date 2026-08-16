#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod windows_collector;

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};
use windows_collector::{WindowsCollector, capabilities};

const PROTOCOL_VERSION: u32 = 1;
const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    protocol_version: u32,
    request_id: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Response<T: Serialize> {
    protocol_version: u32,
    request_id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn send(value: &Value) -> Result<()> {
    let stdout = io::stdout();
    let mut lock = stdout.lock();
    serde_json::to_writer(&mut lock, value).context("serialize response")?;
    lock.write_all(b"\n")?;
    lock.flush()?;
    Ok(())
}

fn response(request_id: String, result: Result<Value>) -> Value {
    match result {
        Ok(data) => serde_json::to_value(Response {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            ok: true,
            data: Some(data),
            error: None,
        })
        .unwrap_or_else(|_| json!({ "ok": false, "error": "Serialization error" })),
        Err(error) => serde_json::to_value(Response::<Value> {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            ok: false,
            data: None,
            error: Some(error.to_string()),
        })
        .unwrap_or_else(|_| json!({ "ok": false, "error": "Serialization error" })),
    }
}

fn main() -> Result<()> {
    send(&json!({
        "type": "hello",
        "protocolVersion": PROTOCOL_VERSION,
        "collectorVersion": env!("CARGO_PKG_VERSION"),
        "capabilities": capabilities()
    }))?;

    let stdin = io::stdin();
    let mut collector = WindowsCollector::new();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(value) => value,
            Err(_) => break,
        };
        if line.len() > MAX_FRAME_BYTES {
            continue;
        }
        let request: Request = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if request.request_id.len() > 128 {
            continue;
        }
        if request.protocol_version != PROTOCOL_VERSION {
            send(&response(
                request.request_id,
                Err(anyhow!("Unsupported protocol version")),
            ))?;
            continue;
        }
        let result = match request.method.as_str() {
            "snapshot" => collector.snapshot(),
            "details" => collector.details(&request.params),
            "action" => collector.action(&request.params),
            _ => Err(anyhow!("Unknown method")),
        };
        send(&response(request.request_id, result))?;
    }
    Ok(())
}

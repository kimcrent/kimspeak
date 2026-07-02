mod native_screen_share;
mod screen_audio;

use native_screen_share::{
    list_capture_sources, start_native_screen_share, stop_native_screen_share,
    NativeScreenShareState,
};

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiRequest {
    base_url: String,
    path: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiResponse {
    ok: bool,
    status: u16,
    text: String,
    content_type: Option<String>,
}

#[tauri::command]
async fn api_request(request: ApiRequest) -> Result<ApiResponse, String> {
    let method = request
        .method
        .parse::<reqwest::Method>()
        .map_err(|err| format!("invalid method: {err}"))?;

    let base_url = request.base_url.trim_end_matches('/');

    let path = if request.path.starts_with('/') {
        request.path
    } else {
        format!("/{}", request.path)
    };

    let url = format!("{base_url}{path}");

    let client = reqwest::Client::new();
    let mut builder = client.request(method, &url);

    for (key, value) in request.headers {
        let name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
            .map_err(|err| format!("invalid header name {key}: {err}"))?;

        let value = reqwest::header::HeaderValue::from_str(&value)
            .map_err(|err| format!("invalid header value for {key}: {err}"))?;

        builder = builder.header(name, value);
    }

    if let Some(body) = request.body {
        builder = builder.json(&body);
    }

    let response = builder
        .send()
        .await
        .map_err(|err| format!("request failed: {err}"))?;

    let status = response.status();

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);

    let text = response
        .text()
        .await
        .map_err(|err| format!("failed to read response: {err}"))?;

    Ok(ApiResponse {
        ok: status.is_success(),
        status: status.as_u16(),
        text,
        content_type,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(NativeScreenShareState::default())
        .invoke_handler(tauri::generate_handler![
            api_request,
            list_capture_sources,
            start_native_screen_share,
            stop_native_screen_share
        ])
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

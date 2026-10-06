//! Mystremio: injects the plugin host into the web UI and stores its plugins.
//!
//! The host (`overlay/host.js`, built from the mystremio-overlay repository) runs inside
//! the official web UI. It talks to this module through `overlay-request` IPC messages.

use std::{
    collections::BTreeMap,
    env, fs,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::stremio_app::{constants::APP_NAME, ipc::RPCResponse};

/// Set to a folder containing `host.js` to load the host from disk on every page load.
pub const OVERLAY_DIR_ENV: &str = "MYSTREMIO_OVERLAY_DIR";
const EMBEDDED_HOST: &str = include_str!("../../overlay/host.js");
const MAX_DOWNLOAD_SIZE: u64 = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    request_id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Plugin {
    id: String,
    /// Relative file path to base64 content.
    files: BTreeMap<String, String>,
}

pub fn host_script() -> String {
    env::var_os(OVERLAY_DIR_ENV)
        .map(|directory| PathBuf::from(directory).join("host.js"))
        .and_then(|path| match fs::read_to_string(&path) {
            Ok(script) => Some(script),
            Err(error) => {
                eprintln!(
                    "Cannot read {}: {error}. Using the built-in host.",
                    path.display()
                );
                None
            }
        })
        .unwrap_or_else(|| EMBEDDED_HOST.to_owned())
}

/// Handles one `overlay-request` and returns the message to post back to the web UI.
pub fn respond(params: &Value) -> Option<String> {
    let request = serde_json::from_value::<Request>(params.clone()).ok()?;
    let payload = match handle(&plugins_directory(), &request.method, &request.params) {
        Ok(result) => json!({ "requestId": request.request_id, "result": result }),
        Err(error) => json!({ "requestId": request.request_id, "error": error }),
    };
    Some(RPCResponse::response_message(Some(json!([
        "overlay-response",
        payload
    ]))))
}

fn plugins_directory() -> PathBuf {
    env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir)
        .join(APP_NAME)
        .join("plugins")
}

fn handle(plugins: &Path, method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "list-plugins" => Ok(json!(list_plugins(plugins))),
        "save-plugin" => {
            let plugin = serde_json::from_value::<Plugin>(params.clone())
                .map_err(|error| format!("Invalid plugin: {error}"))?;
            save_plugin(plugins, &plugin).map(|_| Value::Null)
        }
        "remove-plugin" => {
            let id = params["id"].as_str().ok_or("Missing plugin id")?;
            remove_plugin(plugins, id).map(|_| Value::Null)
        }
        "fetch-url" => {
            let url = params["url"].as_str().ok_or("Missing url")?;
            fetch_url(url, &request_headers(&params["headers"]))
                .map(|bytes| json!(STANDARD.encode(bytes)))
        }
        _ => Err(format!("Unknown overlay method: {method}")),
    }
}

fn is_valid_id(id: &str) -> bool {
    (2..=64).contains(&id.len())
        && !id.starts_with('-')
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Plugin files come from the web UI, so every path must stay inside the plugin folder.
fn is_safe_path(path: &str) -> bool {
    !path.is_empty()
        && path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/'))
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn plugin_directory(plugins: &Path, id: &str) -> Result<PathBuf, String> {
    if is_valid_id(id) {
        Ok(plugins.join(id))
    } else {
        Err(format!("Invalid plugin id: {id}"))
    }
}

fn list_plugins(plugins: &Path) -> Vec<Plugin> {
    let Ok(entries) = fs::read_dir(plugins) else {
        return vec![];
    };
    entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let id = entry.file_name().into_string().ok()?;
            if !is_valid_id(&id) {
                return None;
            }
            let mut files = BTreeMap::new();
            read_files(&entry.path(), "", &mut files).ok()?;
            Some(Plugin { id, files })
        })
        .collect()
}

fn read_files(
    directory: &Path,
    prefix: &str,
    files: &mut BTreeMap<String, String>,
) -> std::io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let relative = format!("{prefix}{name}");
        if entry.path().is_dir() {
            read_files(&entry.path(), &format!("{relative}/"), files)?;
        } else if is_safe_path(&relative) {
            files.insert(relative, STANDARD.encode(fs::read(entry.path())?));
        }
    }
    Ok(())
}

fn save_plugin(plugins: &Path, plugin: &Plugin) -> Result<(), String> {
    let directory = plugin_directory(plugins, &plugin.id)?;
    if let Some(path) = plugin.files.keys().find(|path| !is_safe_path(path)) {
        return Err(format!("Unsafe plugin file path: {path}"));
    }
    let decoded = plugin
        .files
        .iter()
        .map(|(path, content)| Ok((path, STANDARD.decode(content)?)))
        .collect::<Result<Vec<_>, base64::DecodeError>>()
        .map_err(|error| format!("Invalid plugin file content: {error}"))?;

    let write = || -> std::io::Result<()> {
        if directory.exists() {
            fs::remove_dir_all(&directory)?;
        }
        for (path, content) in &decoded {
            let target = directory.join(path);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(target, content)?;
        }
        Ok(())
    };
    write().map_err(|error| format!("Cannot save plugin: {error}"))
}

fn remove_plugin(plugins: &Path, id: &str) -> Result<(), String> {
    let directory = plugin_directory(plugins, id)?;
    if directory.exists() {
        fs::remove_dir_all(directory).map_err(|error| format!("Cannot remove plugin: {error}"))?;
    }
    Ok(())
}

/// Headers a plugin may set on a download. Sites that serve video pages check these.
const ALLOWED_HEADERS: [&str; 4] = ["referer", "user-agent", "origin", "accept"];

fn request_headers(headers: &Value) -> Vec<(String, String)> {
    headers
        .as_object()
        .map(|headers| {
            headers
                .iter()
                .filter(|(name, _)| ALLOWED_HEADERS.contains(&name.to_lowercase().as_str()))
                .filter_map(|(name, value)| Some((name.to_owned(), value.as_str()?.to_owned())))
                .collect()
        })
        .unwrap_or_default()
}

fn fetch_url(url: &str, headers: &[(String, String)]) -> Result<Vec<u8>, String> {
    let url = url::Url::parse(url).map_err(|error| format!("Invalid url: {error}"))?;
    if url.scheme() != "https" {
        return Err("Plugins can only be downloaded over https".to_owned());
    }
    let response = reqwest::blocking::Client::builder()
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        .and_then(|client| {
            headers
                .iter()
                .fold(client.get(url), |request, (name, value)| {
                    request.header(name.as_str(), value.as_str())
                })
                .send()
        })
        .and_then(|response| response.error_for_status())
        .map_err(|error| format!("Download failed: {error}"))?;
    let mut bytes = vec![];
    response
        .take(MAX_DOWNLOAD_SIZE + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Download failed: {error}"))?;
    if bytes.len() as u64 > MAX_DOWNLOAD_SIZE {
        return Err("The download is larger than 20 MB".to_owned());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_plugins() -> PathBuf {
        let directory = env::temp_dir().join(format!("mystremio-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    fn sample(id: &str) -> Plugin {
        Plugin {
            id: id.to_owned(),
            files: BTreeMap::from([
                ("plugin.json".to_owned(), STANDARD.encode("{}")),
                (
                    "lib/index.js".to_owned(),
                    STANDARD.encode("export default 1"),
                ),
            ]),
        }
    }

    #[test]
    fn plugins_round_trip_through_disk() {
        let plugins = temp_plugins();
        save_plugin(&plugins, &sample("sample")).unwrap();
        assert_eq!(list_plugins(&plugins), vec![sample("sample")]);
        assert_eq!(
            fs::read_to_string(plugins.join("sample/lib/index.js")).unwrap(),
            "export default 1"
        );

        remove_plugin(&plugins, "sample").unwrap();
        assert_eq!(list_plugins(&plugins), vec![]);
        fs::remove_dir_all(plugins).unwrap();
    }

    #[test]
    fn saving_replaces_the_previous_files() {
        let plugins = temp_plugins();
        save_plugin(&plugins, &sample("sample")).unwrap();
        let next = Plugin {
            id: "sample".to_owned(),
            files: BTreeMap::from([("plugin.json".to_owned(), STANDARD.encode("{}"))]),
        };
        save_plugin(&plugins, &next).unwrap();
        assert_eq!(list_plugins(&plugins), vec![next]);
        fs::remove_dir_all(plugins).unwrap();
    }

    #[test]
    fn ids_cannot_leave_the_plugins_folder() {
        let plugins = temp_plugins();
        for id in ["..", "../evil", "a/b", "a\\b", "C:", "", "x", "Upper"] {
            assert!(save_plugin(&plugins, &sample(id)).is_err(), "{id}");
            assert!(remove_plugin(&plugins, id).is_err(), "{id}");
        }
        fs::remove_dir_all(plugins).unwrap();
    }

    #[test]
    fn file_paths_cannot_leave_the_plugin_folder() {
        let plugins = temp_plugins();
        for path in [
            "../x.js",
            "a/../../x.js",
            "/x.js",
            "C:/x.js",
            "a\\..\\x.js",
            "a//x.js",
            "",
        ] {
            let plugin = Plugin {
                id: "sample".to_owned(),
                files: BTreeMap::from([(path.to_owned(), String::new())]),
            };
            assert!(save_plugin(&plugins, &plugin).is_err(), "{path}");
        }
        assert_eq!(list_plugins(&plugins), vec![]);
        fs::remove_dir_all(plugins).unwrap();
    }

    #[test]
    fn requests_are_answered_with_their_id() {
        let response = respond(&json!({ "requestId": 7, "method": "nope" })).unwrap();
        let response: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(response["args"][0], "overlay-response");
        assert_eq!(response["args"][1]["requestId"], 7);
        assert_eq!(response["args"][1]["error"], "Unknown overlay method: nope");
    }

    #[test]
    fn only_https_downloads_are_allowed() {
        assert!(fetch_url("http://example.com/plugin.zip", &[]).is_err());
        assert!(fetch_url("file:///C:/plugin.zip", &[]).is_err());
    }

    #[test]
    fn only_listed_request_headers_are_passed_on() {
        let headers = request_headers(&json!({
            "Referer": "https://example.com/",
            "User-Agent": "test",
            "Cookie": "session=1",
            "Authorization": "Bearer x",
            "Accept": 5,
        }));
        assert_eq!(
            headers,
            vec![
                ("Referer".to_owned(), "https://example.com/".to_owned()),
                ("User-Agent".to_owned(), "test".to_owned()),
            ]
        );
        assert!(request_headers(&Value::Null).is_empty());
    }
}

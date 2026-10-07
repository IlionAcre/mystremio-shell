//! Mystremio: a local HLS proxy that downloads several segments at once.
//!
//! Free video hosts cap the speed of each connection, and the player fetches one segment
//! at a time. This proxy sits between the two on 127.0.0.1: it serves the playlist with
//! segment addresses pointing at itself, and whenever the player asks for a segment it
//! starts fetching the next few in parallel, so they are ready when the player gets there.

use std::{
    collections::hash_map::DefaultHasher,
    collections::HashMap,
    hash::{Hash, Hasher},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, Condvar, Mutex},
    thread,
    time::Duration,
};

use once_cell::sync::OnceCell;
use url::Url;

/// How many segments beyond the requested one are fetched ahead.
const AHEAD: usize = 6;
/// Segments already played that are kept, for small backward seeks.
const BEHIND: usize = 2;
const SEGMENT_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_REQUEST_SIZE: usize = 16 * 1024;
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

type Fetcher = Arc<dyn Fn(&str) -> Result<Vec<u8>, String> + Send + Sync>;
type Segment = Result<Arc<Vec<u8>>, String>;

#[derive(Default)]
struct Slot {
    data: Mutex<Option<Segment>>,
    ready: Condvar,
}

#[derive(Default)]
struct State {
    playlists: HashMap<u64, Arc<Vec<String>>>,
    slots: HashMap<(u64, usize), Arc<Slot>>,
}

struct Proxy {
    secret: String,
    fetcher: Fetcher,
    state: Mutex<State>,
}

/// The proxy's address, starting it on first use. `None` if it could not start.
pub fn base_url() -> Option<String> {
    static BASE: OnceCell<Option<String>> = OnceCell::new();
    BASE.get_or_init(|| {
        let client = reqwest::blocking::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(60))
            .build()
            .ok()?;
        let fetcher: Fetcher = Arc::new(move |url| {
            client
                .get(url)
                .send()
                .and_then(|response| response.error_for_status())
                .and_then(|response| response.bytes())
                .map(|bytes| bytes.to_vec())
                .map_err(|error| error.to_string())
        });
        start(fetcher)
            .map_err(|error| eprintln!("Cannot start the HLS proxy: {error}"))
            .ok()
    })
    .clone()
}

fn start(fetcher: Fetcher) -> std::io::Result<String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    let proxy = Arc::new(Proxy {
        // Other programs on this computer cannot guess the path, so they cannot use the proxy.
        secret: uuid::Uuid::new_v4().simple().to_string(),
        fetcher,
        state: Mutex::default(),
    });
    let base = format!("http://127.0.0.1:{port}/{}", proxy.secret);
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let proxy = proxy.clone();
            thread::spawn(move || proxy.serve(stream));
        }
    });
    Ok(base)
}

/// Rewrites a media playlist so every segment is requested from `prefix/{index}`.
/// Returns the new text and the original segment addresses, in order.
fn rewrite_playlist(text: &str, base: &Url, prefix: &str) -> (String, Vec<String>) {
    let mut segments = vec![];
    let lines = text
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                String::new()
            } else if trimmed.starts_with('#') {
                absolute_uri_attribute(trimmed, base)
            } else {
                match base.join(trimmed) {
                    Ok(url) => {
                        segments.push(url.to_string());
                        format!("{prefix}/{}", segments.len() - 1)
                    }
                    Err(_) => trimmed.to_owned(),
                }
            }
        })
        .collect::<Vec<_>>();
    (lines.join("\n") + "\n", segments)
}

/// Keys and init sections stay with the host, so their relative addresses must be made absolute.
fn absolute_uri_attribute(line: &str, base: &Url) -> String {
    const MARK: &str = "URI=\"";
    let Some(start) = line.find(MARK).map(|index| index + MARK.len()) else {
        return line.to_owned();
    };
    let Some(end) = line[start..].find('"').map(|index| index + start) else {
        return line.to_owned();
    };
    match base.join(&line[start..end]) {
        Ok(url) => format!("{}{}{}", &line[..start], url, &line[end..]),
        Err(_) => line.to_owned(),
    }
}

fn playlist_id(url: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    hasher.finish()
}

fn respond(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes()).ok();
    stream.write_all(body).ok();
    stream.flush().ok();
}

/// Reads the request head and returns the request target of a GET.
fn request_target(stream: &mut TcpStream) -> Option<String> {
    let mut head = vec![];
    let mut buffer = [0; 1024];
    while !head.windows(4).any(|window| window == b"\r\n\r\n") {
        let read = stream.read(&mut buffer).ok()?;
        if read == 0 || head.len() + read > MAX_REQUEST_SIZE {
            return None;
        }
        head.extend_from_slice(&buffer[..read]);
    }
    let head = String::from_utf8_lossy(&head);
    let mut parts = head.lines().next()?.split(' ');
    match (parts.next()?, parts.next()?) {
        ("GET", target) => Some(target.to_owned()),
        _ => None,
    }
}

impl Proxy {
    fn serve(self: Arc<Self>, mut stream: TcpStream) {
        stream.set_read_timeout(Some(Duration::from_secs(15))).ok();
        let route = request_target(&mut stream).and_then(|target| {
            target
                .strip_prefix(&format!("/{}", self.secret))
                .map(str::to_owned)
        });
        let Some(route) = route else {
            return respond(&mut stream, "404 Not Found", "text/plain", b"");
        };
        if let Some(query) = route.strip_prefix("/playlist.m3u8?u=") {
            match self.playlist(query) {
                Ok(text) => respond(
                    &mut stream,
                    "200 OK",
                    "application/vnd.apple.mpegurl",
                    text.as_bytes(),
                ),
                Err(error) => respond(
                    &mut stream,
                    "502 Bad Gateway",
                    "text/plain",
                    error.as_bytes(),
                ),
            }
        } else if let Some((id, index)) = route
            .strip_prefix("/seg/")
            .and_then(|rest| rest.split_once('/'))
            .and_then(|(id, index)| Some((id.parse().ok()?, index.parse().ok()?)))
        {
            match self.segment(id, index) {
                Some(Ok(bytes)) => respond(&mut stream, "200 OK", "video/mp2t", &bytes),
                Some(Err(error)) => respond(
                    &mut stream,
                    "502 Bad Gateway",
                    "text/plain",
                    error.as_bytes(),
                ),
                None => respond(&mut stream, "404 Not Found", "text/plain", b""),
            }
        } else {
            respond(&mut stream, "404 Not Found", "text/plain", b"");
        }
    }

    fn playlist(&self, encoded: &str) -> Result<String, String> {
        let address = urlencoding::decode(encoded).map_err(|error| error.to_string())?;
        let url = Url::parse(&address).map_err(|error| error.to_string())?;
        if url.scheme() != "https" {
            return Err("Only https playlists are proxied".to_owned());
        }
        let text = String::from_utf8((self.fetcher)(url.as_str())?)
            .map_err(|_| "The playlist is not text".to_owned())?;
        if !text.starts_with("#EXTM3U") {
            return Err("The host did not return a playlist".to_owned());
        }
        let id = playlist_id(url.as_str());
        let (rewritten, segments) =
            rewrite_playlist(&text, &url, &format!("/{}/seg/{id}", self.secret));
        let mut state = self.state.lock().unwrap();
        // One stream is watched at a time: segments of any other playlist are dropped.
        state.slots.retain(|(other, _), _| *other == id);
        state.playlists.retain(|other, _| *other == id);
        state.playlists.insert(id, Arc::new(segments));
        Ok(rewritten)
    }

    /// Returns the segment, waiting for it if it is still downloading, and starts
    /// downloading the next ones. `None` when the playlist or index is unknown.
    fn segment(self: &Arc<Self>, id: u64, index: usize) -> Option<Segment> {
        let slot = {
            let mut state = self.state.lock().unwrap();
            let segments = state.playlists.get(&id)?.clone();
            if index >= segments.len() {
                return None;
            }
            state.slots.retain(|(other, at), _| {
                *other != id || (*at + BEHIND >= index && *at <= index + AHEAD * 2)
            });
            let last = (index + AHEAD).min(segments.len() - 1);
            for at in index..=last {
                if !state.slots.contains_key(&(id, at)) {
                    let slot = Arc::new(Slot::default());
                    state.slots.insert((id, at), slot.clone());
                    let (proxy, url) = (self.clone(), segments[at].clone());
                    thread::spawn(move || {
                        let result = (proxy.fetcher)(&url).map(Arc::new);
                        *slot.data.lock().unwrap() = Some(result);
                        slot.ready.notify_all();
                    });
                }
            }
            state.slots.get(&(id, index))?.clone()
        };
        let data = slot.data.lock().unwrap();
        let (data, timeout) = slot
            .ready
            .wait_timeout_while(data, SEGMENT_TIMEOUT, |data| data.is_none())
            .unwrap();
        if timeout.timed_out() {
            return Some(Err("The host took too long".to_owned()));
        }
        data.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::atomic::{AtomicUsize, Ordering},
        time::Instant,
    };

    fn get(base: &str, path: &str) -> (u16, Vec<u8>) {
        let address = base.trim_start_matches("http://");
        let (host, prefix) = address.split_once('/').unwrap();
        let mut stream = TcpStream::connect(host).unwrap();
        let target =
            if path.starts_with('/') && !path.starts_with("/playlist") && !path.starts_with("/seg")
            {
                path.to_owned()
            } else {
                format!("/{prefix}{path}")
            };
        write!(stream, "GET {target} HTTP/1.1\r\nHost: {host}\r\n\r\n").unwrap();
        let mut response = vec![];
        stream.read_to_end(&mut response).unwrap();
        let split = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .unwrap();
        let head = String::from_utf8_lossy(&response[..split]).to_string();
        let status = head.split(' ').nth(1).unwrap().parse().unwrap();
        (status, response[split + 4..].to_vec())
    }

    const PLAYLIST: &str = "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:10,\nseg-0.ts?t=1\n#EXTINF:10,\nhttps://other.test/seg-1.ts\n#EXT-X-ENDLIST\n";

    #[test]
    fn playlists_point_segments_at_the_proxy_and_keep_keys_with_the_host() {
        let base = Url::parse("https://cdn.test/hls/index.m3u8?t=1").unwrap();
        let (text, segments) = rewrite_playlist(PLAYLIST, &base, "/s/seg/7");
        assert_eq!(
            segments,
            vec![
                "https://cdn.test/hls/seg-0.ts?t=1",
                "https://other.test/seg-1.ts"
            ]
        );
        assert_eq!(
            text,
            "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-KEY:METHOD=AES-128,URI=\"https://cdn.test/hls/key.bin\"\n#EXTINF:10,\n/s/seg/7/0\n#EXTINF:10,\n/s/seg/7/1\n#EXT-X-ENDLIST\n"
        );
    }

    /// A host with twenty segments that takes a while to answer each request.
    fn slow_host(calls: Arc<AtomicUsize>, delay: Duration) -> Fetcher {
        Arc::new(move |url: &str| {
            if url.ends_with(".m3u8") {
                let segments = (0..20)
                    .map(|index| format!("#EXTINF:10,\nseg-{index}.ts\n"))
                    .collect::<String>();
                return Ok(format!("#EXTM3U\n{segments}#EXT-X-ENDLIST\n").into_bytes());
            }
            if url.contains("seg-13") {
                return Err("gone".to_owned());
            }
            calls.fetch_add(1, Ordering::SeqCst);
            thread::sleep(delay);
            Ok(url.as_bytes().to_vec())
        })
    }

    #[test]
    fn the_next_segments_are_ready_before_the_player_asks() {
        let calls = Arc::new(AtomicUsize::new(0));
        let base = start(slow_host(calls.clone(), Duration::from_millis(300))).unwrap();
        let (status, playlist) = get(
            &base,
            "/playlist.m3u8?u=https%3A%2F%2Fcdn.test%2Fhls%2Findex.m3u8",
        );
        assert_eq!(status, 200);
        let first = String::from_utf8(playlist)
            .unwrap()
            .lines()
            .find(|line| line.contains("/seg/"))
            .unwrap()
            .to_owned();
        assert!(first.ends_with("/0"), "{first}");

        // The first segment takes one host delay; the next six download meanwhile.
        let started = Instant::now();
        let (status, body) = get(&base, &first);
        assert_eq!(
            (status, body),
            (200, b"https://cdn.test/hls/seg-0.ts".to_vec())
        );
        assert!(started.elapsed() >= Duration::from_millis(280));

        thread::sleep(Duration::from_millis(350));
        let stem = first.rsplit_once('/').unwrap().0;
        assert_eq!(calls.load(Ordering::SeqCst), 1 + AHEAD);
        for index in 1..=AHEAD {
            let started = Instant::now();
            let (status, body) = get(&base, &format!("{stem}/{index}"));
            assert_eq!(status, 200);
            assert_eq!(
                body,
                format!("https://cdn.test/hls/seg-{index}.ts").into_bytes()
            );
            assert!(
                started.elapsed() < Duration::from_millis(150),
                "segment {index} was not ready"
            );
        }
    }

    #[test]
    fn errors_and_unknown_requests_are_reported() {
        let base = start(slow_host(Arc::default(), Duration::ZERO)).unwrap();
        // Nothing is served without the secret path.
        assert_eq!(
            get(
                &base,
                "/other/playlist.m3u8?u=https%3A%2F%2Fcdn.test%2Fa.m3u8"
            )
            .0,
            404
        );
        // Only https hosts are fetched.
        assert_eq!(
            get(&base, "/playlist.m3u8?u=http%3A%2F%2Fcdn.test%2Fa.m3u8").0,
            502
        );
        // A segment of a playlist that was never requested.
        assert_eq!(get(&base, "/seg/1/0").0, 404);

        let (_, playlist) = get(
            &base,
            "/playlist.m3u8?u=https%3A%2F%2Fcdn.test%2Fhls%2Findex.m3u8",
        );
        let first = String::from_utf8(playlist)
            .unwrap()
            .lines()
            .find(|line| line.contains("/seg/"))
            .unwrap()
            .to_owned();
        // Beyond the end of the playlist.
        let stem = first.rsplit_once('/').unwrap().0;
        assert_eq!(get(&base, &format!("{stem}/99")).0, 404);
        // A segment the host fails to deliver.
        assert_eq!(get(&base, &format!("{stem}/13")).0, 502);
    }
}

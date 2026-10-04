# Mystremio shell

A fork of `Stremio/stremio-shell-ng`. It loads the official web UI and injects the
Mystremio plugin host into it. `main` follows upstream; the work is on `mystremio`.

## What differs from upstream

Keep this list short. Every difference is a possible merge conflict.

| File | Change |
|---|---|
| `src/stremio_app/overlay.rs` | New. Supplies the host script and stores plugins in `%APPDATA%\Mystremio\plugins` |
| `overlay/host.js` | New. Built copy of the host from the `mystremio-overlay` repository |
| `src/stremio_app/stremio_wevbiew/wevbiew.rs` | Injects the host script when page content starts loading |
| `src/stremio_app/app.rs` | Handles the `overlay-request` IPC command. Skips the updater unless `--autoupdater-endpoint` is given |
| `src/stremio_app/constants.rs` | `APP_NAME` and `IPC_PATH`, so it runs as its own app |
| `src/stremio_app/window_settings.rs` | Window settings folder is `%APPDATA%\Mystremio` |

## Build and run

```powershell
cargo build
cargo run
```

A fresh `target\debug` lacks the streaming server, and the app then stays on a blank
page. Copy these next to the built executable once, as the installer does: the contents
of `bin\`, plus `server.js`, `stremiover.js` and `libmpv-2.dll`.

To work on the host without rebuilding the shell, point the shell at the overlay build
folder. The host is then read from disk on every page load, so rebuild the overlay and
press Ctrl+R in the app:

```powershell
$env:MYSTREMIO_OVERLAY_DIR = "D:\Work\Stremio\overlay\dist"
cargo run
```

To refresh the built-in copy, build the overlay and copy `dist/host.js` to
`overlay/host.js`.

## Known limits

- The streaming server uses a fixed port, so Mystremio and official Stremio cannot run
  at the same time. They can be installed side by side.
- The installer scripts in `setup/` still describe official Stremio.
- `stremio_server::process` tests fail on the development server with timeouts. They fail
  the same way on unmodified upstream there.

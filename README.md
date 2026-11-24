# Antigravity (agy) usage for OpenChamber

Adds an **Antigravity (agy)** usage card to OpenChamber's Usage panel. It reads the official Antigravity CLI `/usage` output and shows the Gemini group's **5-Hour** and **Weekly** windows, without per-model rows.

## Requirements

- OpenChamber `>= 2.8.0`
- Antigravity CLI `agy` installed and signed in, with `agy` on `PATH`

## Install

Open this link in OpenChamber:

```
openchamber://extensions/install?url=https%3A%2F%2Fgithub.com%2FShazzaky%2Fopenchamber-antigravity-usage
```

Or add the repository from **Settings → Extensions**.

For a private clone, install from the local folder or use the repository's SSH URL.

## How it works

The extension's host service runs:

```sh
agy -p "/usage" --output-format json
```

It reads `command.data.groups`, keeps the `Gemini Models` group, and returns its `5h` and `weekly` buckets in that order. Results are cached for 10 minutes and concurrent requests share one CLI run.

It does **not** read OAuth tokens and does **not** call Google APIs directly.

## Development

```sh
bun install
bun run build
bun run check
```

The built `service/main.js` is committed because OpenChamber installs never build.

## Notes

Not affiliated with Google. “Antigravity” and its logo are Google brand marks, used here only to identify the service this extension reports on.

# cdx

Codex session wrapper CLI.

## Why

- Keeping sessions separate by use case (development, testing, review) helps maintain accuracy.
- Managing multiple sessions manually is tedious; this tool streamlines it.

## Requirements

- Codex CLI installed and available as `codex` in your PATH

## Notes

- This is an unofficial community tool and is not affiliated with OpenAI.
- This tool does not bundle or redistribute the Codex CLI.
- Scope: manage Codex session selection and launch/resume workflows only.
- OpenAI, Codex, and related marks are trademarks of their respective owners.

## .cdx format

Each line is:

```
<uuid>\t<label>
```

## Usage

- `cdx` to select or create a session
- `cdx here` to use `.cdx` from the current directory without parent search
- `cdx new` to create a new session without the selection UI
- `cdx new here` or `cdx here new` to create a new session using `.cdx` from the current directory
- `cdx rm` to remove a session from `.cdx`
- `cdx init` to create an empty `.cdx` in the current directory
- `cdx add <uuid> <label>` to add a session to `.cdx`
- `cdx add <uuid>` to add a session and prompt for the label
- `cdx add` to add a session and prompt for uuid and label
- `cdx -h`, `cdx --help`, or `cdx help` to show help
- `cdx -V` or `cdx --version` to show version
- `cdx -v` or `cdx --verbose` to show verbose logs

## Install (npm)

```
npm install -g @fclef819/cdx
```

## Install (local/dev)

```
npm install
npm link
```

## Issues & Feedback

If you find a bug or want an enhancement, please open an issue in:
https://github.com/fclef819/-fclef-cdx
Repro steps and environment details are appreciated.

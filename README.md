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
- `cdx rm` to remove a session from `.cdx`
- `cdx rm here` or `cdx here rm` to remove a session from `.cdx` in the current directory
- `cdx -h`, `cdx --help`, or `cdx help` to show help

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

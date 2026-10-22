# GitHub Vault Sync (Obsidian plugin)

[Türkçe](README.tr.md) · English

Two-way sync between your Obsidian vault and a GitHub repository. No Git installation needed: the plugin talks to GitHub's web API, so it works the same way on Windows, Mac, Linux and iPhone/iPad.

> **Status:** early release (0.1.0). Tested on Windows desktop: pushing local changes, pulling remote changes, conflicts and deletions. Not yet tested on Mac or iPhone. Back up your vault before the first sync if your notes matter to you.

## What it does

- Keeps the files in your vault in sync with a branch of a GitHub repository, including text, images and other attachments.
- If a file changed only on your side, it is uploaded. If it changed only on GitHub (for example a bot or another device wrote to it), it is downloaded.
- Uploads are made as a single commit.
- Syncs when Obsidian starts, at a configurable interval (default 5 min) and 1 minute after you change a file. You can also run it manually (the refresh icon in the left ribbon, or the "GitHub ile şimdi senkronla" command).

## Installation

### Option 1: with BRAT (recommended, updates automatically)

1. In Obsidian go to Settings → **Community plugins**, turn off Restricted mode, then **Browse**, install and enable **BRAT**.
2. In BRAT's settings choose **Add beta plugin**, enter `Alpinoo/github-obsidian-sync` and add it.
3. Enable **GitHub Vault Sync** in the Community plugins list.
4. Enter your token and repository details as described under "Settings".

When a new version is released, BRAT updates the plugin for you.

### Option 2: manual

1. Download `main.js` and `manifest.json` from the [Releases](https://github.com/Alpinoo/github-obsidian-sync/releases) page.
2. In your vault folder, create `.obsidian/plugins/github-vault-sync/` and put the two files in it. (`.obsidian` is a hidden folder.)
3. Restart Obsidian and enable the plugin under Community plugins.

## Settings

| Setting | Description |
|---|---|
| **GitHub token** | Create a fine-grained token at [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new). *Repository access:* only the repository you want to sync. *Permissions → Contents:* **Read and write**. |
| **User / Repository / Branch** | For example `username`, `my-notes`, `main`. The repository must already exist and contain at least one commit. |
| **Auto-sync interval** | In minutes. `0` turns it off. |
| **Sync on startup** | Runs once when Obsidian opens. |
| **Sync 1 min after a change** | Syncs shortly after a file changes. |

The token is entered **on each device separately**. It is stored only in the plugin settings on that device and is never sent anywhere except in GitHub API calls.

## Conflicts and deletions

For each file the plugin remembers its state at the last successful sync and compares three versions: local, GitHub and last-synced.

| Situation | What happens |
|---|---|
| Changed only locally | Uploaded to GitHub |
| Changed only on GitHub | Downloaded locally |
| **Changed on both sides** | Your local version is uploaded; the GitHub version is downloaded next to it as `name (çakışma DATE).md` ("çakışma" means "conflict"). Merge by hand and delete the extra file. No data is lost. |
| Deleted locally | Deleted on GitHub too |
| Deleted on GitHub | Moved to Obsidian's trash locally |
| Deleted on one side, changed on the other | Not deleted; the changed version is kept |

Safety measures:

- If a single sync would need more than 25 deletions, the plugin **stops** and reports an error (protection against a misconfiguration).
- If the remote repository looks empty, local files are not deleted.
- Folders and files starting with a dot (`.obsidian`, `.git`, `.trash`, etc.) are never synced. This matters because the token is stored inside `.obsidian`.
- Files larger than 25 MB are skipped.

## Limitations

- Every sync reads the full file list from GitHub. On very large repositories (tens of thousands of files) GitHub truncates the list and the plugin stops with an error.
- If several devices write at the same moment, the plugin retries up to 3 times; if that fails it tries again on the next sync.
- Conflict resolution is per file, not line by line.
- Hidden folders (including `.obsidian`) are not synced, so plugins, themes and settings are not carried between devices.
- If a file name on GitHub contains characters Windows does not allow (`: * ? " < > |`), that file cannot be created on Windows.
- The user interface text (commands, notices) is currently in Turkish.

## Development

```bash
npm install --legacy-peer-deps
npm run build
```

The build produces `main.js`. To publish a version, bump `version` in `manifest.json` and `package.json`, then attach `main.js` and `manifest.json` to a GitHub release with the same version number (BRAT and the manual install both use the release files).

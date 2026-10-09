# Recursive Community marketplace

Plugins for [Recursive](https://recursive.computer) from publishers other than the Recursive team. The app reads this catalog as its built-in **Recursive Community** marketplace (Settings → Plugin marketplaces).

Every plugin is one file, `entries/<id>.json`, added by pull request. CI checks the entry and its package; a Recursive maintainer reviews it; merging publishes `community.json` to `https://releases.recursive.computer/marketplace/v1/community.json`.

You don't need to be listed here to share a plugin. Anyone can publish their own marketplace and people add it in Settings → Plugin marketplaces: a `marketplace.json` at an https URL, in a GitHub repository (root, `.recursive-plugin/` or `.claude-plugin/`), or in a folder. It has the same shape as `community.json`: `{ "schemaVersion": 1, "name": "your-name", "displayName": "…", "plugins": [ …entries… ] }`. Claude Code marketplaces are read as they are.

## Add a plugin

1. Choose where Recursive gets the plugin:

   - **A public GitHub repository** (`"type": "github"`): Recursive fetches it and builds it on install. This is the simplest path.
   - **A prebuilt package** (`"type": "artifact"`): a `.tgz` built by the Recursive plugin packer (`plugin:pack`, shipping with the plugin SDK), served over https, with its `size` and `sha256` in the entry. Packages install faster because their operations are bundled and their UI is precompiled.

2. Add `entries/<id>.json`:

   ```json
   {
     "id": "acme-lint",
     "name": "Acme Lint",
     "description": "Flags style problems before you commit. Runs locally; no account needed.",
     "version": "1.2.0",
     "tags": ["lint", "code-quality"],
     "author": { "name": "Acme", "url": "https://acme.dev" },
     "homepage": "https://github.com/acme/acme-lint",
     "source": {
       "type": "artifact",
       "url": "https://your.cdn/plugins/acme-lint-1.2.0.tgz",
       "sha256": "…",
       "size": 12345
     }
   }
   ```

   or, for a GitHub source:

   ```json
   "source": { "type": "github", "repo": "acme/acme-lint", "plugin_path": "plugin" }
   ```

3. Check it locally, then open a pull request:

   ```bash
   node scripts/build.mjs --check --verify-downloads
   ```

## Rules

- The file name, `id`, and the plugin's own `plugin.json` id match. Ids are lowercase letters, digits and dashes.
- Ids starting with `recursive`, and ids of Recursive Official plugins, are reserved.
- Packages are served over https and match the entry's `size` and `sha256`. Publish a new version under a new URL and update the entry; never replace bytes behind a published URL.
- `description` is at most 300 characters and names every cost: an external service, a paid account, a separate install, or a limited operating system.
- Allowed fields: `id`, `name`, `description`, `version`, `icon`, `color`, `category`, `tags` (at most 10), `author` (`name`, optional `url`), `homepage`, `min_recursive_version`, `provides`, `source`.

Adding or refreshing a marketplace in Recursive only reads this catalog; nothing is installed until someone chooses a plugin, and the app checks the package's sha256 before unpacking it.

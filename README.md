# render-env-cli

Manage environment variables on [Render](https://render.com) services from the command line, through the [Render REST API](https://api-docs.render.com).

The official Render CLI has no commands for the environment variables of an existing service. This tool fills that gap: list, read, set, delete and bulk-import variables, and optionally trigger a deploy afterwards.

```bash
npx render-env-cli --service my-api list
```

Requires Node.js 20.12 or newer. Once installed (`npm i -g render-env-cli`) the command is also available as `render-env`.

## Authentication

Create an API key in the Render dashboard under **Account Settings → API Keys** and export it:

```bash
export RENDER_API_KEY=rnd_xxxxxxxx
```

When `RENDER_API_KEY` is not set and the command runs in a terminal, it prompts for the key without echoing it. The key is never written to disk.

## Choosing the service

Pass `--service` (`-s`) with either the service ID (`srv-…`, or `crn-…` for cron jobs) or the exact service name. A name is resolved through the API; if several services share it, use the ID. `RENDER_SERVICE` sets a default:

```bash
export RENDER_SERVICE=srv-d0abc123xyz
```

## Commands

### `list` (alias `ls`)

```bash
render-env -s my-api list                 # keys, values masked
render-env -s my-api list --show-values   # keys and values
render-env -s my-api list --json          # JSON, values masked unless --show-values
```

### `get <KEY>`

Prints the raw value, so it can be piped:

```bash
render-env -s my-api get DATABASE_URL | pbcopy
```

### `set <KEY> [value]`

```bash
render-env -s my-api set FRONTEND_URL https://example.com
render-env -s my-api set TURNSTILE_SECRET_KEY            # hidden prompt
pbpaste | render-env -s my-api set TURNSTILE_SECRET_KEY  # from stdin
render-env -s my-api set SESSION_SECRET --generate       # Render generates a random value
render-env -s my-api set FEATURE_FLAG on --deploy        # deploy afterwards
```

Without a `value` argument the value is read from stdin when it is piped, or from a hidden prompt in a terminal. One trailing newline is stripped from stdin.

### `unset <KEY...>` (alias `rm`)

```bash
render-env -s my-api unset OLD_KEY ANOTHER_KEY --deploy
```

### `import <file>`

Sets every variable from a `.env` file. It first prints the change set (key names only), then asks for confirmation:

```bash
render-env -s my-api import .env.production --dry-run   # show the diff only
render-env -s my-api import .env.production             # confirm, then apply
render-env -s my-api import .env.production --yes       # no prompt (CI)
render-env -s my-api import .env.production --prune     # also delete keys missing from the file
cat .env | render-env -s my-api import - --yes          # from stdin
```

```
+ NEW_KEY
~ CHANGED_KEY
1 to add, 1 to change, 0 to delete, 12 unchanged
```

Variables on Render that are not in the file are kept unless `--prune` is passed. Outside a terminal, applying requires `--yes`.

Variables are written one at a time with `PUT /services/{id}/env-vars/{key}`. The bulk `PUT /services/{id}/env-vars` endpoint replaces the whole set, so it is not used.

### `--deploy`

`set`, `unset` and `import` accept `--deploy`, which calls `POST /services/{id}/deploys` once the changes are saved, so the running service picks up the new values.

## Limitations

Only variables set directly on a service are managed. Variables that come from a linked environment group are not listed or changed.

## Security notes

- Values are masked in `list` unless `--show-values` is passed. `set`, `unset` and `import` never print values.
- A value passed as an argument to `set` ends up in your shell history. For secrets, pipe it through stdin or use the hidden prompt.
- Prefer `RENDER_API_KEY` from a secret manager or an environment file excluded from version control. The API key grants access to every service in the workspaces you belong to.
- Requests that hit the rate limit are retried up to three times, honouring `Retry-After`.

## Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
node dist/cli.js --help
```

Tests mock the HTTP layer; they never call the Render API.

## License

MIT

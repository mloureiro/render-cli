# render-cli

Manage [Render](https://render.com) services from the command line, through the [Render REST API](https://api-docs.render.com).

It complements the official `render` CLI, starting with what that one cannot do: managing the environment variables of an existing service.

```bash
npm install -g rendercli
render-cli setup
render-cli env -s my-api list
```

Requires Node.js 20.12 or newer.

## Install

Install it globally once and the `render-cli` command is on your `PATH`:

```bash
npm install -g rendercli
```

To try it without installing, prefix commands with `npx`: `npx rendercli env -s my-api list`.

## Authentication

### `render-cli setup`

```bash
render-cli setup
```

1. Opens the Render dashboard page that creates an API key (`--no-browser` prints the URL instead).
2. Reads the key from a hidden prompt, or from stdin when piped: `pbpaste | render-cli setup`.
3. Checks the key against the API and prints the workspaces it can reach.
4. Asks where to store it:
   - the render-cli credentials file, `~/.config/render-cli/credentials.json` (or `$XDG_CONFIG_HOME/render-cli/`), created with mode `0600`;
   - a `.env` file of your choice, where it sets `RENDER_API_KEY` and warns if git does not ignore the file.

Non-interactive form: `render-cli setup --env-file .env` saves to both, and `--no-config` skips the credentials file. The key is never printed.

### Where the key is read from

In order:

1. `RENDER_API_KEY` in the environment.
2. The render-cli credentials file.
3. The login of the official Render CLI (`~/.render/cli.yaml`, as written by `render login`), while its token has not expired. `RENDER_CLI_CONFIG_PATH` and `RENDER_CLI_CONFIG_DIR` are honoured.
4. A hidden prompt, when running in a terminal.

## Environment variables: `render-cli env`

Every `env` command needs a service: `--service` (`-s`) takes the service ID (`srv-…`, or `crn-…` for cron jobs) or the exact service name. `RENDER_SERVICE` sets a default. If several services share a name, use the ID.

### `env list` (alias `ls`)

```bash
render-cli env -s my-api list                 # keys, values masked
render-cli env -s my-api list --show-values   # keys and values
render-cli env -s my-api list --json          # JSON, values masked unless --show-values
```

### `env get <KEY>`

Prints the raw value, so it can be piped:

```bash
render-cli env -s my-api get DATABASE_URL | pbcopy
```

### `env set <KEY> [value]`

```bash
render-cli env -s my-api set FRONTEND_URL https://example.com
render-cli env -s my-api set TURNSTILE_SECRET_KEY            # hidden prompt
pbpaste | render-cli env -s my-api set TURNSTILE_SECRET_KEY  # from stdin
render-cli env -s my-api set SESSION_SECRET --generate       # Render generates a random value
render-cli env -s my-api set FEATURE_FLAG on --deploy        # deploy afterwards
```

Without a `value` argument the value is read from stdin when it is piped, or from a hidden prompt in a terminal. One trailing newline is stripped from stdin.

### `env unset <KEY...>` (alias `rm`)

```bash
render-cli env -s my-api unset OLD_KEY ANOTHER_KEY --deploy
```

### `env import <file>`

Sets every variable from a `.env` file. It first prints the change set (key names only), then asks for confirmation:

```bash
render-cli env -s my-api import .env.production --dry-run   # show the diff only
render-cli env -s my-api import .env.production             # confirm, then apply
render-cli env -s my-api import .env.production --yes       # no prompt (CI)
render-cli env -s my-api import .env.production --prune     # also delete keys missing from the file
cat .env | render-cli env -s my-api import - --yes          # from stdin
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

### Limitations

Only variables set directly on a service are managed. Variables that come from a linked environment group are not listed or changed.

## Security notes

- Values are masked in `env list` unless `--show-values` is passed. `set`, `unset`, `import` and `setup` never print values or keys.
- A value passed as an argument to `env set` ends up in your shell history. For secrets, pipe it through stdin or use the hidden prompt.
- An API key grants access to every service in the workspaces you belong to. Keep the credentials file private and any `.env` holding the key out of version control.
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

Commands live in `src/commands/`, one module per command group, registered in `src/program.ts`. Tests mock the HTTP layer and the file system; they never call the Render API.

## License

MIT

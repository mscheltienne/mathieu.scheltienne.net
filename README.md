[![build](https://github.com/mscheltienne/mathieu.scheltienne.net/actions/workflows/build.yaml/badge.svg?branch=main)](https://github.com/mscheltienne/mathieu.scheltienne.net/actions/workflows/build.yaml)

# mathieu.scheltienne.net

Source of my personal website, built with [Hugo](https://gohugo.io) (extended, ≥ 0.158)
and the [hugo-coder](https://github.com/luizdepra/hugo-coder) theme (git submodule). The
site lives in `src/`: content in `src/content/`, theme overrides in `src/layouts/` and
`src/assets/`. The GitHub highlights on the home page are served by a Cloudflare Worker
in `worker/`, whose SVG rendering (`worker/src/render.js`) is shared with the site.

On push to `main`, GitHub Actions deploys the site to GitHub Pages and Cloudflare Workers
Builds deploys the Worker.

## Development

```sh
git submodule update --init --recursive  # fetch the theme
brew install hugo                        # or the extended build from the GitHub releases

cd src && hugo server                    # http://localhost:1313, live reload
uvx pre-commit run --all-files           # lint (yamllint, toml-sort, Biome)
```

Worker (requires a GitHub token, classic, with `repo` and `read:user`):

```sh
cd worker && npm ci
echo 'GITHUB_TOKEN=<token>' > .dev.vars  # git-ignored
npm run dev                              # http://localhost:8787/data.json and /card.svg
npm run build                            # bundle check, as in CI

# Site against the local Worker (from src/):
HUGO_PARAMS_GITHUBHIGHLIGHTS_ENDPOINT=http://localhost:8787/data.json hugo server

# Without wrangler: fetch the data, then render the README card to preview it.
npm run fetch-local -- <token-file> data.json
npm run render-card -- data.json out/
```

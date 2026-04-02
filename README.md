# Doehyun's personal website

Originally cloned from [the minimal theme](https://github.com/pages-themes/minimal).
History claborred for personal use.

# Local development

Run

```bash
docker run --rm -it --entrypoint bash -p 4000:4000 -v "$PWD":/github/workspace -w /github/workspace ghcr.io/actions/jekyll-build-pages:v1.0.13 -lc 'git config --global --add safe.directory /github/workspace && bundle install && bundle exec jekyll serve --config /github/workspace/_config.yml --source /github/workspace --host 0.0.0.0 --port 4000'
```
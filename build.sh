mkdir -p docs
cp -r src/* docs
drop-inline-css -r src -o docs
deno bundle --allow-import \
  --platform=browser \
  --format=esm \
  -o docs/index.js \
  --external=https://cdn.jsdelivr.net/npm/mediabunny@1.56.0/+esm \
  --external=https://cdn.jsdelivr.net/* \
  --external=https://cdn.jsdelivr.net/gh/* \
  --external=https://marmooo.github.io/* \
  src/index.js
minify -r docs -o .

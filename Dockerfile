# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV RETALE_HANLP_VENV_DIR=/opt/hanlp-venv \
  HANLP_HOME=/opt/hanlp-home

FROM base AS build
# CPU-only torch keeps CUDA wheels out of the image; the smoke test also bakes the HanLP model into HANLP_HOME.
# Writes .env.local with HANLP_PYTHON_BIN / HANLP_BOOTSTRAP_SCRIPT_PATH for the app.
COPY scripts/setup-hanlp-runtime.mjs scripts/
COPY hanlp_bootstrap.py ./
RUN PIP_NO_CACHE_DIR=1 PIP_EXTRA_INDEX_URL=https://download.pytorch.org/whl/cpu \
  node scripts/setup-hanlp-runtime.mjs --smoke
ENV RETALE_SKIP_HANLP_SETUP=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev && rm -rf .next/cache build

FROM base
ENV NODE_ENV=production
COPY --from=build --chown=node:node /opt /opt
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME /app/data
EXPOSE 14500
# Plain `next start`: the image is immutable, so npm start's lsof and source-fingerprint guards don't apply.
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "14500"]

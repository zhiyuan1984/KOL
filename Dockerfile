FROM node:22-bookworm AS fe
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json* frontend/.npmrc* ./
RUN npm install --ignore-scripts=false --foreground-scripts
COPY frontend ./
RUN npm run build

FROM node:22-bookworm
WORKDIR /app
RUN npm install -g @openai/codex
COPY backend/package.json backend/package-lock.json* backend/.npmrc* /app/backend/
RUN cd /app/backend && npm install --omit=dev --ignore-scripts=false --foreground-scripts \
  && (npm rebuild better-sqlite3 --ignore-scripts=false || true) \
  && (npm rebuild esbuild --ignore-scripts=false || node ./node_modules/esbuild/install.js)
COPY backend /app/backend
COPY --from=fe /src/frontend/dist /app/frontend/dist
ENV LINGONG_DATA=/app/data
ENV CODEX_MODE=real
ENV CODEX_HOME=/root/.codex
EXPOSE 8765
WORKDIR /app/backend
CMD ["npx", "tsx", "src/index.ts"]

# Dedicated business-map test branch: test failure prevents image publication.
# Application source is committed directly in this Codeup branch, not fetched externally.
FROM node:22-bookworm AS verification
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends chromium postgresql fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
COPY frontend /src/frontend
COPY backend /src/backend
COPY shared /src/shared
COPY config /src/config
COPY agents /src/agents
COPY experts /src/experts
COPY policies /src/policies
COPY docs /src/docs
COPY scripts /src/scripts
RUN printf 'd22e147711addbae657d4cc189166d614e7ac1affc591a6b41511b4aaba3b90a  backend/migrations/20261021_050_runtime_connector_oauth_accounts.sql\n387dc7248475990a9fb35b28714764219bbe62f3a0519c4b72317f90fda65200  backend/package-lock.json\n765aff3de1930c675179c02a5dc1ab21ba6d3c23e9052e01c209509fda501941  backend/src/app.ts\nb40d3a76c6220288f1f7ac1f6fc3fd897b512447a3bb454dd3a110b187de1913  backend/src/auth.ts\n2f233b40d2edd7784a231016130d4cbec10011c8ab791ddc670a147554cf3fb9  backend/src/business-map/catalog.ts\nc94b5899d35914d06df1f0dce3aa479974dd9c7d15ec18c31110e12a2e752158  backend/src/business-map/projection.ts\nae22d5b067fbbe44e7839d87fb75ab01063d9d40c10939e83667e6734894e6bd  backend/src/business-map/service.ts\ndba5aa49dcb17a6db8495891c91a784008cade26a5f60a32fcab55b2b941cff5  backend/src/crawl/background-crawl.ts\n30dd00ba4b5cb67eaa37f62b9f0efabbbb71d7dabe77f5d9d2a2d6e034322488  backend/src/crawl/runtime-gates.ts\n164f4753e2b314abbba6c89b1e07685f5da673fd5ced4764795e3bde8f2c09e1  backend/src/mcp/oauth-client.ts\n52037317029c348deb2453d24fe9db8c37225a4c08fbd0b09df3e6993ad83295  backend/src/mcp/remote.ts\n714b42e4defef91532226f2f6cc4d325dcbb164c2ad273074cd89edecad8acca  backend/src/ontology/wecom-source.ts\n4224870b19271af3ad6a4f48f82c704181e2dc743ac55a46506c9ae476e95e59  backend/src/postgres/migrations.ts\n018c6cd0a5fd1b53f73617814c36d210bccb1e37eb7db466e427a86390000209  backend/src/routers/business-map.ts\ne9d3c8d806f424dac4a5b0cef98082effc374be992dbd5d59f851eff00982386  backend/src/routers/connector-oauth.ts\nc10e2328488449270eac3758b0caeda433da983a4773a3c8d168df1fb3a80271  backend/src/runtime/credentials.ts\n9c76fd1c3fa949c25caf0f8928517e5e7236ac715e86d93ca2faa6050e008d2e  backend/src/runtime/execution.ts\neef64fb4e8eeaada9e62c019ec600eb0c6d52e5a573432d8d47de98bd3a87acb  backend/src/runtime/managed-client.ts\n45be829a0b6040a86d0ee2bed0b538a8b146257c5c23acad475935ce8553c431  backend/src/runtime/mediacrawler-probe.ts\nfc01f0b786910bc9ba10f3a738f193c3fac37e3f3c29d53411aa6ec4a248fe1f  backend/src/runtime/oauth-credentials.ts\n36b718f95a38fc146c28f58c893a276e0cf13662dfd0be885c73ebd8669814ac  backend/src/runtime/store.ts\n09e5c24c3903bda487a13ff5ee43ac3c195f1faf75d481b3a4c79351fe07b717  backend/tests/business-map.postgres.test.ts\ne74ea6f1678499e05d2fa1e5bb873a9526362ef717abd7881518fafe870b3268  backend/tests/business-map.test.ts\n982f067ac6651af111bd81dd1906d8a2f0b445ea6c795fe19d70243630a1c90c  frontend/e2e/business-map-browser.spec.ts\n40109ad6fe2855f464f62eff4b89279f3032609183ef2cc435dbdd8c1b732bc5  frontend/package-lock.json\n383cc272eb4b5341164e9e0fcafb8960be167918a8f679bc69d3af9560e04176  frontend/playwright.business-map.config.ts\n51fa97248a0935dba4ad02e6894fc346402ff5b5d96c2229da171a3e4085838d  frontend/src/admin/business-map/BusinessMapWorkspace.css\n9c6a641a49ff0c4cd01fee707fa4413aa9fdc69d7c514dbb244e5e756893220c  frontend/src/admin/business-map/BusinessMapWorkspace.test.tsx\n92f6003890750a27663bd31123aed839227186c522b4878aaf55fd048c79b67a  frontend/src/admin/business-map/BusinessMapWorkspace.tsx\nd1862abd3cc0dd401aa1c9e8dd5e61d7ff5ba71eb6d45593d8fa92e0a7f81ebd  frontend/src/admin/business-map/api.ts\nc00a3ec04e9a2aaea2bfcf321148ba626c79f67dd7d9a498129187e680ccc767  frontend/src/admin/business-map/model.ts\n42e50fffa955d2cf412a7e79f0cb59c9399d6d99b4425c3cc0e0d1f312b1f607  frontend/src/admin/business-map/types.ts\n8de173ace1b7577c99bca50a0fc9d2a023b6b856a922d4ef1f08287dac34c000  frontend/src/admin/connector/ConnectorConfigCard.tsx\n1ab027a8bbdef59b7fca8b691fcca13cf96c866df380b57fc6f687ba80d18071  frontend/src/admin/connector/connectorSetup.ts\n09e8d3c30e78837b007865356a35827d347a5808f6271af243ec6d0067fc9926  frontend/src/api.ts\nf92d8bdff215553f336eac1f1951a81efa370eeed9c2e6e9dccde267b186be67  frontend/src/layout/adminNav.ts\ncc6eec305377d48c61f7f9c792ee0dc75d86597ca52ac6f8635fb81e0601e431  frontend/src/layout/sidebarNav.test.ts\n94e104379361ca897fa7678fa3c628be27d288555c839a6c25d015b7c9d198cb  frontend/src/pages/AccountSettings.tsx\nca6b5b3aaad9b9c8cd7f96f3ae29f1b1abef2971690d3e21906c5b7a8b29ac97  frontend/src/pages/AdminBusinessMap.tsx\na25ccc829526a7b79ac62c6b72c3e899c54b50e2e36601351e6ac9b5c8e794f5  frontend/src/pages/AdminConsole.tsx\n7a9b7d899997caa0b0f92774ed773af91ee1e1ba2feb239cb97485967c01f91e  frontend/src/runtimeConnectorUi.ts\na4b282170e6cbeac025daff9b57b03141ddb6e6f63b41eb9d376aa8bd9acb1cd  frontend/src/settings/McpAccountSettings.tsx\nb1acc888c27d38a312eed5b63f9088d8bf104e9514e887f3f16f755a9d9223b3  frontend/src/settings/settings.css\n8f3d6ef9257696f3693196a12478dc854037618d5fa237764bc509bf2fb58f8c  frontend/vite.business-map.config.ts\nf099c9d427653bc61dfdd0f0a14660bf8fe16ea4af3658aea19c2aab786b5280  frontend/vitest.business-map.config.ts\n2f5c94d409abd637d113d5f2042b48ae04c43ce4e96e0080ee40389f1ef6673b  scripts/test-business-map-codeup.sh\n2e0489205a587ae11cad501a58641d8601a9c36a3ddb320c38592cf4078413bc  shared/business-map.ts\n' | sha256sum --check
RUN cd /src/backend && npm ci --no-audit --no-fund --ignore-scripts=false --foreground-scripts && cd /src/frontend && npm ci --no-audit --no-fund --ignore-scripts=false --foreground-scripts
ENV VITE_BUILD_COMMIT=2ad91b60
ENV PW_EXECUTABLE_PATH=/usr/bin/chromium
RUN BUSINESS_MAP_CI_BOOTSTRAP=1 bash /src/scripts/test-business-map-codeup.sh

FROM verification AS fe
WORKDIR /src/frontend
RUN test -s dist/index.html && test -s /src/.business-map-ci/summary.json

FROM node:22-bookworm
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-impress fonts-noto-cjk poppler-utils \
    python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY backend/tools/pageindex-bridge/requirements.txt /tmp/knowledge-requirements.txt
RUN python3 -m venv /opt/knowledge-python \
    && /opt/knowledge-python/bin/pip install --no-cache-dir -r /tmp/knowledge-requirements.txt
ENV KNOWLEDGE_PAGEINDEX_PYTHON=/opt/knowledge-python/bin/python
RUN npm install -g @openai/codex
COPY backend/package.json backend/package-lock.json* backend/.npmrc* /app/backend/
RUN cd /app/backend && npm install --omit=dev --ignore-scripts=false --foreground-scripts \
  && (npm rebuild better-sqlite3 --ignore-scripts=false || true) \
  && (npm rebuild esbuild --ignore-scripts=false || node ./node_modules/esbuild/install.js)
COPY backend /app/backend
COPY shared /app/shared
COPY config /app/config
COPY agents /app/agents
COPY experts /app/experts
COPY policies /app/policies
COPY scripts /app/scripts
COPY --from=fe /src/frontend/dist /app/frontend/dist
COPY --from=verification /src/.business-map-ci /app/verification/business-map
ENV LINGONG_DATA=/app/data
ENV CODEX_MODE=real
ENV CODEX_HOME=/root/.codex
EXPOSE 8765
WORKDIR /app/backend
CMD ["npx", "tsx", "src/index.ts"]

ARG BASE_IMAGE=lcd/evolution:pre-408-20261119
FROM ${BASE_IMAGE}
COPY timeoutRecovery.cjs /evolution/timeoutRecovery.cjs
COPY patch.cjs /tmp/lcd-408-patch.cjs
RUN node /tmp/lcd-408-patch.cjs && node --check /evolution/dist/main.js

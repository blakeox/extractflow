FROM node:20-alpine

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install

COPY frontend /app

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 CMD wget -q -O - http://localhost:3000 >/dev/null 2>&1 || exit 1

CMD ["npm", "run", "dev"]

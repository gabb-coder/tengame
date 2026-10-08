# --- build the client ---
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY . .
RUN npm run build

# --- runtime: game server + built client ---
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false
COPY shared shared
COPY server server
COPY --from=build /app/client/dist client/dist
EXPOSE 8080
CMD ["npm", "start", "--workspace", "server"]

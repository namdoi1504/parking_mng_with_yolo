FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_API_BASE_URL=""
# Tests reference repository AI fixtures outside this build context.
RUN npx tsc --project tsconfig.docker.json && npx tsc --project tsconfig.node.json && npx vite build

FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

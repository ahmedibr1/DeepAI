# Portal web (React portal + DeepDive Builder module), served by unprivileged nginx.
FROM node:22-alpine AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm run build:offline

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist /usr/share/nginx/html
# The standalone offline builder stays downloadable for users without portal access
COPY --from=build /web/dist-offline/DeepDive_Builder.html /usr/share/nginx/html/downloads/DeepDive_Builder.html
EXPOSE 8080

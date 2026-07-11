FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_PRODUCTION_API
ARG VITE_COST_API
ARG VITE_AUDIT_API
ENV VITE_PRODUCTION_API=$VITE_PRODUCTION_API
ENV VITE_COST_API=$VITE_COST_API
ENV VITE_AUDIT_API=$VITE_AUDIT_API
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

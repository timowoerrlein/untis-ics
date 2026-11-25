FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV OUT_DIR=/data PORT=8080 TZ=Europe/Berlin
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "src/main.ts"]

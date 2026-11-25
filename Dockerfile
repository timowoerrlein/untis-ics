FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV OUT_DIR=/data PORT=8080 TZ=Europe/Berlin
# Created before VOLUME so a new named volume is owned by `node`, who writes the feeds.
RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "src/main.ts"]

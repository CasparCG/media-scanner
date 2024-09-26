FROM node:18 AS builder
  WORKDIR /usr/src/app

  COPY package.json yarn.lock .yarnrc.yml ./
  RUN sed -i -e 's/^		"version": "[0-9.]\+",$//' package.json
  RUN corepack enable

  COPY ./src ./src
  COPY tsconfig.build.json ./

  RUN yarn install
  RUN yarn build:ts

  RUN sed -i -e 's/^		"postinstall": "husky",$//' package.json
  RUN yarn workspaces focus --production

FROM node:18
  WORKDIR /usr/src/app
  ENV NODE_ENV=production
  ENV PATHS__FFMPEG=ffmpeg
  ENV PATHS__FFPROBE=ffmpeg

  RUN apt-get update && \
      apt-get install ffmpeg -y && \
      rm -rf /var/lib/apt/lists/*

  COPY --from=builder /usr/src/app/package.json ./
  COPY --from=builder /usr/src/app/dist ./dist
  COPY --from=builder /usr/src/app/node_modules ./node_modules
     
  CMD [ "node", "dist" ]
  HEALTHCHECK CMD curl -f http://localhost:8000/healthcheck || exit 1

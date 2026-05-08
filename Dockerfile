FROM node:26 AS builder
  WORKDIR /usr/src/app

  COPY package.json yarn.lock .yarnrc.yml ./
  RUN sed -i -e 's/^		"version": "[0-9.]\+",$//' package.json
  RUN corepack enable

  COPY ./src ./src
  COPY tsconfig.json ./
  COPY ./tools ./tools

  RUN yarn install
  RUN UNPACKED=1 yarn build

  RUN rm deploy/*.zip

FROM node:26
  WORKDIR /usr/src/app
  ENV NODE_ENV=production
  ENV PATHS__FFMPEG=ffmpeg
  ENV PATHS__FFPROBE=ffmpeg

  RUN apt-get update && \
      apt-get install ffmpeg -y && \
      rm -rf /var/lib/apt/lists/*

  COPY --from=builder /usr/src/app/deploy /usr/src/app

  ENTRYPOINT [ "node", "helper.js" ]
  HEALTHCHECK CMD curl -f http://localhost:8000/healthcheck || exit 1

FROM node:8.9.4 as PACKAGE
  WORKDIR /usr/src/app
  COPY package.json ./
  RUN sed -i -e 's/^  "version": "[0-9.]\+",$//' package.json

FROM node:8.9.4
  WORKDIR /usr/src/app
  ENV NODE_ENV production

	COPY --from=casparcg/ffmpeg:3.4.1 /opt/ffmpeg /usr/bin/ffmpeg

  COPY --from=PACKAGE /usr/src/app ./
  COPY yarn.lock ./
  RUN yarn --pure-lockfile
  COPY ./src ./src

  CMD [ "node", "src" ]
  HEALTHCHECK CMD curl -f http://localhost:8000/healthcheck || exit 1

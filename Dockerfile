FROM node:18
  WORKDIR /usr/src/app
  ENV NODE_ENV production
  ENV PATHS__FFMPEG ffmpeg
  ENV PATHS__FFPROBE ffmpeg

  COPY package.json package-lock.json ./
  RUN sed -i -e 's/^  "version": "[0-9.]\+",$//' package.json
  RUN yarn install && \
      apt-get update && \
      apt-get install ffmpeg -y

  COPY ./src ./src

  CMD [ "node", "src" ]
  HEALTHCHECK CMD curl -f http://localhost:8000/healthcheck || exit 1

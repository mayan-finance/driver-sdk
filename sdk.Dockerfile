FROM node:20-bullseye-slim As build

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm config set update-notifier false; npm ci --loglevel=error
RUN npm install -g ts-node

COPY . .

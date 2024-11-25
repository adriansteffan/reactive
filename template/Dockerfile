FROM node:21-bookworm-slim

RUN apt-get update
RUN apt-get upgrade -y

WORKDIR /srv/frontend

# TODO TODO TODO 
COPY . .
COPY .env .env

RUN npm install

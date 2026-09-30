FROM node:20-alpine
WORKDIR /app
COPY server.js ./
COPY public ./public
ENV PORT=80 DATA_DIR=/data
VOLUME /data
EXPOSE 80
CMD ["node", "server.js"]

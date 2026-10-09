FROM node:22-alpine
WORKDIR /app
COPY server.js tools.json ./
COPY public ./public
COPY prepare-assets.cjs ./
RUN node prepare-assets.cjs
ENV NODE_ENV=production
EXPOSE 4090
CMD ["node", "server.js"]

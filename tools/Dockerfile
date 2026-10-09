FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY server.js ./
COPY public ./public
COPY prepare-assets.cjs ./
RUN node prepare-assets.cjs
RUN npm run build:styles
ENV NODE_ENV=production
EXPOSE 4087 4088
CMD ["node", "server.js"]

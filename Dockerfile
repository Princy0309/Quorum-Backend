FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install && npm cache clean --force
RUN npx prisma generate && rm -rf /root/.cache

COPY . .

EXPOSE 5000

CMD ["npx", "tsx", "server.js"]

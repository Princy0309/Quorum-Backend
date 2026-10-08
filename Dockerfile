FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --omit=dev --no-optional && npm cache clean --force
RUN npx prisma generate && rm -rf /root/.cache

COPY . .

EXPOSE 5000

CMD ["npx", "tsx", "server.ts"]
